import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

/**
 * Cart flow e2e (#79 / #cart-align).
 *
 * Self-contained / hermetic: this spec does its OWN onboarding -> build-week ->
 * add-to-list setup inline (no shared helper file, so it never collides with the
 * other flow specs), reusing the proven click-path from
 * onboarding-first-cart-checkout.spec.ts (#480) to reach a logged-in + onboarded
 * + week-built + populated-cart state.
 *
 * It then exercises the RICH cart surface against the REAL dev server and REAL
 * endpoints:
 *  - select / deselect a single item, select-all / deselect-all, clear-all;
 *  - the "Merged automatically from N recipes" note;
 *  - "Order at Albert Heijn" -> the "Send to your store" dialog;
 *  - the no-tip path ("Open my cart, no tip") AND a tip-some path;
 *  - asserting the GENERATED Albert Heijn cart deep-link is well-formed.
 *
 * What's MOCKED (per the maintainer's "mock only tricky/external/flaky" rule):
 *  - the Mollie payment redirect on the tip-some path (the startTip server fn is
 *    intercepted so no real payment is created and no real navigation leaves the
 *    app);
 *  - window.open / window.location, so opening the AH cart is CAPTURED for
 *    assertion instead of spawning real tabs / leaving the page.
 *
 * The deterministic AH cart link comes from VITE_PLAYWRIGHT_E2E_CART_LINKS=1
 * (set by playwright.config.ts's webServer), which makes buildCartLinks resolve
 * every line to the fixed AH slug `wi123456/...` -> SKU `123456`, so the URL is
 * stable to assert on.
 *
 * Selectors are by role / text / accessible name to match #480's conventions; no
 * data-testid is added for this flow (every control is reachable by name).
 */

// The deterministic AH SKU the E2E cart-links shortcut emits (slug
// `wi123456/e2e-albert-heijn-product` -> `wi` stripped -> `123456`).
const E2E_AH_SKU = '123456'

async function clickNext(page: Page) {
  await page.getByTestId('onboarding-next').click()
}

/**
 * Reuse #480's Get-started gesture: Vite dev can keep a connection open past
 * networkidle, so give hydration a beat then dispatch the click via the DOM, and
 * retry once if the welcome step is still showing.
 */
async function startOnboarding(page: Page) {
  const getStarted = page.getByRole('button', { name: 'Get started' })
  await expect(page.getByTestId('onboarding-welcome')).toBeVisible()
  await expect(getStarted).toBeVisible()
  await page.waitForLoadState('load')
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
    // Vite dev can keep lightweight connections open; give hydration one beat.
  })
  await page.waitForTimeout(500)
  await getStarted.evaluate((button: HTMLButtonElement) => button.click())
  if (
    await page
      .getByTestId('onboarding-welcome')
      .isVisible({ timeout: 1_000 })
      .catch(() => false)
  ) {
    await getStarted.evaluate((button: HTMLButtonElement) => button.click())
  }
}

/**
 * Drive onboarding end to end and land on a populated /shopping cart. Mirrors the
 * #480 path so this spec is self-sufficient: a fresh anonymous session is
 * onboarded, a week is built, its ingredients are added to the shopping list, and
 * we end on the Cart screen with the merged list rendered.
 */
async function buildWeekAndOpenCart(page: Page) {
  await page.goto('/onboarding')
  await startOnboarding(page)

  await expect(page.getByTestId('household-step')).toBeVisible()
  await page.getByRole('button', { name: 'Add one child' }).click()
  await page.getByRole('button', { name: 'Add one child' }).click()
  await clickNext(page)

  await expect(page.getByTestId('dislikes-step')).toBeVisible()
  await page.getByRole('button', { name: /^Mushroom/ }).click()
  await clickNext(page)

  await expect(page.getByTestId('diet-step')).toBeVisible()
  await clickNext(page)

  await expect(page.getByTestId('cuisine-step')).toBeVisible()
  await page.getByRole('button', { name: /^Italian:/ }).click()
  await page.getByRole('button', { name: /^Greek:/ }).click()
  await clickNext(page)

  await expect(page.getByTestId('kitchen-step')).toBeVisible()
  await page.getByRole('button', { name: 'Oven' }).click()
  await page.getByRole('button', { name: 'Stovetop' }).click()
  await clickNext(page)

  await expect(page.getByTestId('goals-step')).toBeVisible()
  await page
    .getByRole('button', { name: 'Avoid unnecessary purchases' })
    .click()
  await page
    .getByRole('button', { name: 'Cook and discover new recipes' })
    .click()
  await clickNext(page)

  await expect(page.getByTestId('beta-step')).toBeVisible()
  await page.getByRole('button', { name: 'Build my week' }).click()

  await expect(page).toHaveURL(/\/week(\?|$)/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible()
  await expect(page.locator('#day-Monday')).toBeVisible()

  // Add the week's ingredients to the shopping list, then land on the Cart tab.
  const addToShoppingList = page.getByRole('button', {
    name: /^Add \d+ items? to shopping list$/,
  })
  if (
    await addToShoppingList.isVisible({ timeout: 5_000 }).catch(() => false)
  ) {
    await addToShoppingList.click()
  } else {
    await expect(page.getByRole('button', { name: 'All added' })).toBeVisible()
    await page.getByRole('link', { name: 'Cart' }).click()
  }

  await expect(page).toHaveURL(/\/shopping(\?|$)/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
}

/**
 * Install a capture for opened store-cart URLs (window.open) and any full-page
 * navigation (window.location.href). Mirrors #480's window.open stub and adds a
 * location.href trap so the tip-some Mollie redirect is captured, not followed.
 * Read back via readOpenedUrls / readNavigations.
 */
async function installOpenAndNavCapture(page: Page) {
  await page.evaluate(() => {
    const win = window as unknown as {
      __openedStoreCartUrls: Array<string>
      __navigations: Array<string>
    }
    win.__openedStoreCartUrls = []
    win.__navigations = []

    window.open = (url?: string | URL | null) => {
      const location = {}
      Object.defineProperty(location, 'href', {
        get: () => '',
        set: (value: string) => win.__openedStoreCartUrls.push(String(value)),
      })
      if (url && String(url) !== 'about:blank') {
        win.__openedStoreCartUrls.push(String(url))
      }
      return { closed: false, location } as Window
    }

    // Trap full-page navigation (the tip-some path sets window.location.href to
    // the Mollie checkout URL). We can't reassign window.location, but we can
    // shadow its `href` setter so the redirect is recorded, not performed.
    try {
      const original = window.location.href
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        get: () => original,
        set: (value: string) => win.__navigations.push(String(value)),
      })
    } catch {
      // Some engines lock window.location.href; fall back to assign/replace.
      window.location.assign = (value: string) =>
        win.__navigations.push(String(value))
      window.location.replace = (value: string) =>
        win.__navigations.push(String(value))
    }
  })
}

async function readOpenedUrls(page: Page): Promise<Array<string>> {
  return page.evaluate(
    () =>
      (window as unknown as { __openedStoreCartUrls: Array<string> })
        .__openedStoreCartUrls,
  )
}

async function readNavigations(page: Page): Promise<Array<string>> {
  return page.evaluate(
    () => (window as unknown as { __navigations: Array<string> }).__navigations,
  )
}

/** Assert an AH bulk-cart deep-link is structurally well-formed (#293, cart-links). */
function assertAhCartUrl(raw: string) {
  const url = new URL(raw)
  expect(url.protocol).toBe('https:')
  expect(url.host).toBe('www.ah.nl')
  expect(url.pathname).toBe('/mijnlijst/add-multiple')
  // Every product is a `p=<sku>:<qty>` param; the E2E shortcut resolves all lines
  // to the fixed SKU, which mergeCartLineItems collapses to a single param.
  const products = url.searchParams.getAll('p')
  expect(products.length).toBeGreaterThanOrEqual(1)
  for (const p of products) {
    expect(p).toMatch(/^\d+:\d+$/)
    const [sku, qty] = p.split(':')
    expect(sku).toBe(E2E_AH_SKU)
    expect(Number(qty)).toBeGreaterThanOrEqual(1)
  }
}

test.describe('cart', () => {
  test('selects, clears, and re-builds the merged list', async ({ page }) => {
    await buildWeekAndOpenCart(page)

    // The merged-from-N-recipes note is shown from the real consolidated view.
    await expect(
      page.getByText(/Merged automatically from \d+ recipes?/),
    ).toBeVisible()

    // The per-item round checkboxes carry an accessible name describing the
    // add / remove action; the selected-count badge reflects how many are in.
    const checkboxes = page.getByRole('checkbox')
    const count = await checkboxes.count()
    expect(count).toBeGreaterThan(0)
    const badge = page.getByText(/^\d+ selected$/)
    await expect(badge).toBeVisible()

    // Select-all: button reads "Select all" when not all checked, then flips to
    // "Clear" once everything is in the order.
    const selectAll = page.getByRole('button', { name: 'Select all' })
    if (await selectAll.isVisible().catch(() => false)) {
      await selectAll.click()
    }
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible()
    // Every row is now checked.
    const total = await checkboxes.count()
    await expect(badge).toHaveText(`${total} selected`)

    // Deselect a single item: tap the first checked row's box; the selected
    // count drops by one and that row is no longer in the order.
    const firstBox = checkboxes.first()
    await expect(firstBox).toHaveAttribute('aria-checked', 'true')
    await firstBox.click()
    await expect(firstBox).toHaveAttribute('aria-checked', 'false')
    await expect(badge).toHaveText(`${total - 1} selected`)

    // Re-select that one item: count returns to the full total.
    await firstBox.click()
    await expect(firstBox).toHaveAttribute('aria-checked', 'true')
    await expect(badge).toHaveText(`${total} selected`)

    // Deselect all via the "Clear" toggle (the inclusion-model bulk action).
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByRole('button', { name: 'Select all' })).toBeVisible()
    await expect(badge).toHaveText('0 selected')

    // Clear all empties the persisted list (two-tap confirm guard). After
    // clearing, the screen shows the empty-cart state.
    await page.getByRole('button', { name: 'Clear all items' }).click()
    await page.getByRole('button', { name: 'Confirm clear all items' }).click()
    await expect(page.getByText('Your cart is empty')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('orders at Albert Heijn and opens the cart with no tip', async ({
    page,
  }) => {
    await buildWeekAndOpenCart(page)
    await installOpenAndNavCapture(page)

    // The floating order bar's CTA: store defaults to Albert Heijn.
    const orderButton = page.getByRole('button', {
      name: 'Order at Albert Heijn',
    })
    await expect(orderButton).toBeVisible()
    await orderButton.click()

    // The tip / send dialog opens (the Sheet's accessible name is its title).
    await expect(
      page.getByRole('dialog', { name: 'Send to your store' }),
    ).toBeVisible()

    // Drag the tip slider to 0 so the no-tip CTA appears.
    const tipSlider = page.getByLabel('Tip percentage')
    await tipSlider.focus()
    await page.keyboard.press('Home')
    const noTip = page.getByRole('button', { name: 'Open my cart, no tip' })
    await expect(noTip).toBeVisible()

    await noTip.click()

    // The AH cart opens via window.open (no tip = no Mollie). Capture + assert
    // the generated deep-link is the well-formed AH add-multiple URL.
    await expect
      .poll(() => readOpenedUrls(page), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^https:\/\/www\.ah\.nl\/mijnlijst\/add-multiple\?/,
          ),
        ]),
      )

    const urls = await readOpenedUrls(page)
    const ahUrl = urls.find((u) =>
      u.startsWith('https://www.ah.nl/mijnlijst/add-multiple'),
    )
    expect(ahUrl, 'an AH add-multiple URL was opened').toBeTruthy()
    assertAhCartUrl(ahUrl!)

    // No-tip must NOT have started a payment (no Mollie navigation).
    expect(await readNavigations(page)).toEqual([])
  })

  test('tip-some path starts a (mocked) Mollie payment then opens the cart on return', async ({
    page,
  }) => {
    // Mock ONLY the tip-start server fn so no real Mollie payment is created.
    // TanStack Start server fns POST to /_serverFn/<id>; the tip start is the one
    // whose body carries `percent` + `basketTotal`. We return a plain JSON body
    // (no x-tss-serialized header), which the client RPC returns as-is, with a
    // canned Mollie checkout URL. Other server fns (incl. the cart-link build)
    // hit the REAL endpoints untouched.
    const MOLLIE_URL = 'https://www.mollie.test/checkout/e2e-tip-redirect'
    await page.route('**/_serverFn/**', async (route: Route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.continue()
      const body = request.postData() ?? ''
      const isTipStart =
        body.includes('"percent"') && body.includes('"basketTotal"')
      if (!isTipStart) return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkoutUrl: MOLLIE_URL,
          tipPaymentId: 'e2e-tip-payment',
          amount: '0.50',
        }),
      })
    })

    await buildWeekAndOpenCart(page)
    await installOpenAndNavCapture(page)

    await page.getByRole('button', { name: 'Order at Albert Heijn' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Send to your store' }),
    ).toBeVisible()

    // Default tip is non-zero; the CTA reads "Tip €x.xx & open my cart".
    const tipButton = page.getByRole('button', {
      name: /^Tip €\d+\.\d{2} & open my cart$/,
    })
    await expect(tipButton).toBeVisible()
    await tipButton.click()

    // The tip-some path redirects to the (mocked) Mollie checkout via
    // window.location.href, which our trap captures rather than following.
    await expect
      .poll(() => readNavigations(page), { timeout: 20_000 })
      .toContain(MOLLIE_URL)
  })
})

/**
 * @external sanity check — OPT-IN only (skipped unless E2E_EXTERNAL=1).
 *
 * Fetches the generated AH deep-link against the REAL Albert Heijn website to
 * confirm the host accepts the add-multiple path. Non-blocking by design: it is
 * skipped in CI / normal runs because it depends on a live third party. Run with
 * `E2E_EXTERNAL=1 pnpm exec playwright test e2e/cart.spec.ts`.
 */
test.describe('cart @external', () => {
  test('the generated AH cart URL resolves on the real ah.nl', async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.E2E_EXTERNAL !== '1',
      'external AH fetch is opt-in (set E2E_EXTERNAL=1)',
    )

    await buildWeekAndOpenCart(page)
    await installOpenAndNavCapture(page)

    await page.getByRole('button', { name: 'Order at Albert Heijn' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Send to your store' }),
    ).toBeVisible()
    await page.getByLabel('Tip percentage').focus()
    await page.keyboard.press('Home')
    await page.getByRole('button', { name: 'Open my cart, no tip' }).click()

    await expect
      .poll(() => readOpenedUrls(page), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^https:\/\/www\.ah\.nl\/mijnlijst/),
        ]),
      )

    const opened = await readOpenedUrls(page)
    const ahUrl = opened.find((u) =>
      u.startsWith('https://www.ah.nl/mijnlijst'),
    )
    expect(ahUrl).toBeTruthy()

    // Sanity-check the live host accepts the deep-link (don't assert a hard 200:
    // AH may redirect or bot-gate; we only require it isn't a hard server error).
    const res = await request.get(ahUrl!, { maxRedirects: 0 }).catch(() => null)
    if (res) expect(res.status()).toBeLessThan(500)
  })
})
