import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function clickNext(page: Page) {
  await page.getByTestId('onboarding-next').click()
}

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

/** Pin AH before ordering — the floating bar follows the selected store. */
async function ensureAhStoreSelected(page: Page) {
  const ah = page.getByRole('radio', { name: /Albert Heijn/ })
  await expect(ah).toBeVisible()
  if (!(await ah.isChecked())) await ah.click()
  await expect(ah).toBeChecked()
}

test.describe('onboarding to checkout', () => {
  test('builds a first week, creates a cart, and hands checkout to the user', async ({
    page,
  }) => {
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
    await expect(page.getByTestId('week-label')).toBeVisible()
    await expect(page.locator('#day-Monday')).toBeVisible()

    const addToShoppingList = page.getByRole('button', {
      name: /^Add \d+ items? to shopping list$/,
    })
    if (
      await addToShoppingList.isVisible({ timeout: 5_000 }).catch(() => false)
    ) {
      await addToShoppingList.click()
    } else {
      await expect(
        page.getByRole('button', { name: 'All added' }),
      ).toBeVisible()
      await page.getByRole('link', { name: 'Cart' }).click()
    }

    await expect(page).toHaveURL(/\/shopping(\?|$)/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
    await expect(
      page.getByText(/Merged automatically from \d+ recipes?/),
    ).toBeVisible()
    await ensureAhStoreSelected(page)
    await expect(
      page.getByRole('button', { name: 'Order at Albert Heijn' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Order at Albert Heijn' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Send to your store' }),
    ).toBeVisible()

    const tipSlider = page.getByLabel('Tip percentage')
    await tipSlider.focus()
    await page.keyboard.press('Home')
    await expect(
      page.getByRole('button', { name: 'Open my cart, no tip' }),
    ).toBeVisible()

    await page.evaluate(() => {
      const openedUrls: Array<string> = []
      ;(
        window as unknown as { __openedStoreCartUrls: Array<string> }
      ).__openedStoreCartUrls = openedUrls

      window.open = (url?: string | URL | null) => {
        const location = {}
        Object.defineProperty(location, 'href', {
          get: () => '',
          set: (value: string) => openedUrls.push(String(value)),
        })
        if (url && String(url) !== 'about:blank') openedUrls.push(String(url))
        return { closed: false, location } as Window
      }
    })

    await page.getByRole('button', { name: 'Open my cart, no tip' }).click()

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __openedStoreCartUrls: Array<string> })
                .__openedStoreCartUrls,
          ),
        { timeout: 15_000 },
      )
      .toContainEqual(
        expect.stringMatching(/^https:\/\/www\.ah\.nl\/mijnlijst/),
      )
  })
})
