import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Week-tab end-to-end coverage (route /week, the planning surface).
 *
 * The fifth flow, alongside the merged onboarding / search / cart / profile
 * specs. Self-contained / hermetic: this spec does its OWN onboarding ->
 * Build-my-week click-path inline (no shared helper file, so it never collides
 * with the other flow specs), reusing the proven path from
 * onboarding-first-cart-checkout.spec.ts (#480) to reach a signed-in +
 * onboarded household sitting on a freshly built week.
 *
 * It then exercises the REAL /week surface against the REAL dev server and REAL
 * endpoints (generateWeekForOffset / clearWeekForOffset / loadWeekForOffset /
 * applySimilarSwapToPlan / clearDayInPlan / addWeekToShoppingList) - nothing is
 * mocked:
 *  - build the current week, then CLEAR it back to the empty state, then build
 *    again (the demo clean-slate loop, #377 / #week-control);
 *  - go to NEXT week and generate it, then go BACK to the current week and
 *    confirm its state is intact (the prev/next nav, #week-nav);
 *  - REMOVE a day's dinner (the "eating out" escape hatch, #255);
 *  - SWAP a day's dinner for a pre-ranked alternative (the swap chooser, #291);
 *  - OPEN a day's recipe sheet and close it (the recipe pull-up, #291);
 *  - add the week to the shopping list and land on the Cart tab.
 *
 * Selectors are by role / text / accessible name to match #480's conventions
 * (getByRole / getByText / getByLabel). The only data-testids read are the
 * read-only visibility anchors the page already exposes (week-label, the
 * onboarding step containers) plus the `#day-<Day>` row anchors the page itself
 * defines for scroll-into-view - no new test-only hooks are added.
 *
 * Mobile viewport (390x844, Pixel 7) comes from playwright.config.ts, as does
 * the dev server with VITE_PLAYWRIGHT_E2E_CART_LINKS=1.
 */

/** Click the onboarding "Next" affordance (the testid #480 leans on). */
async function clickNext(page: Page) {
  await page.getByTestId('onboarding-next').click()
}

/**
 * Kick off onboarding from the welcome step. Mirrors #480: Vite-dev hydration
 * can lag past networkidle, so wait for load, give hydration a beat, then
 * dispatch the click via the DOM and retry once if the welcome board is still
 * showing.
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
 * Drive onboarding end to end and land on a freshly built week (/week?week=0).
 * Mirrors the #480 path so this spec is self-sufficient: a fresh dev session
 * (auto-authenticated as dev@souso.local locally) is onboarded, then "Build my
 * week" generates this week's plan and routes to /week.
 */
async function onboardToBuiltWeek(page: Page) {
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

  await expectBuiltWeek(page)
}

/** A built week has landed: URL is /week, the heading + label + first row show. */
async function expectBuiltWeek(page: Page) {
  await expect(page).toHaveURL(/\/week(\?|$)/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible()
  await expect(page.getByTestId('week-label')).toBeVisible()
  await expect(page.locator('#day-Monday')).toBeVisible({ timeout: 30_000 })
}

/**
 * The dish "open recipe" buttons carry an accessible name of the form
 * `Open <Day>: <meal>`. Return a locator for the first such button so a test can
 * tap a real planned dish without hard-coding a day's recipe name.
 */
function firstDishButton(page: Page) {
  return page.getByRole('button', { name: /^Open \w+: / }).first()
}

test.describe('week', () => {
  test('builds, clears back to empty, and rebuilds the current week', async ({
    page,
  }) => {
    await onboardToBuiltWeek(page)

    // Clear week: the header action wipes this week's plan and the route
    // re-resolves to the empty state with a "Build my week" CTA (#377).
    await page.getByRole('button', { name: 'Clear week' }).click()
    const buildCta = page.getByRole('button', { name: 'Build my week' })
    await expect(buildCta).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('No plan for this week yet')).toBeVisible()
    // Still on the week route, just the empty shell of it.
    await expect(page).toHaveURL(/\/week(\?|$)/)
    await expect(page.getByTestId('week-label')).toBeVisible()

    // Build again from the empty state: the plan regenerates in place and the
    // built week renders without a manual reload.
    await buildCta.click()
    await expectBuiltWeek(page)
  })

  test('navigates to next week, builds it, and back to this week intact', async ({
    page,
  }) => {
    await onboardToBuiltWeek(page)

    // Capture how many planned dishes this week has, to confirm it survives the
    // round-trip to next week and back.
    const dishes = page.getByRole('button', { name: /^Open \w+: / })
    await expect(dishes.first()).toBeVisible()
    const thisWeekDishes = await dishes.count()
    expect(thisWeekDishes).toBeGreaterThan(0)

    // Next week: the nav flips the ?week offset. A future week starts empty
    // (#week-nav bug 1: no auto-clone of this week) with a "Generate next week"
    // CTA, so generate it explicitly.
    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.getByTestId('week-label')).toHaveText('Next week', {
      timeout: 30_000,
    })
    const generate = page.getByRole('button', { name: 'Generate next week' })
    if (await generate.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await generate.click()
    }

    // Next week is built (freshly or from a prior run): heading + a Monday row.
    await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible()
    await expect(page.getByTestId('week-label')).toHaveText('Next week')
    await expect(page.locator('#day-Monday')).toBeVisible({ timeout: 30_000 })

    // Back to this week: the prev nav returns to the current week and its plan
    // is intact (same dish count, label back to "This week").
    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(page.getByTestId('week-label')).toHaveText('This week', {
      timeout: 30_000,
    })
    await expect(page.locator('#day-Monday')).toBeVisible({ timeout: 30_000 })
    await expect(dishes.first()).toBeVisible()
    expect(await dishes.count()).toBe(thisWeekDishes)
  })

  test('opens a recipe sheet and closes it', async ({ page }) => {
    await onboardToBuiltWeek(page)

    // Tap a planned dish: the recipe pull-up opens, titled with the dish name
    // (its accessible dialog name). We read the dish's name off its open-button
    // so the assertion never hard-codes a recipe.
    const dish = firstDishButton(page)
    await expect(dish).toBeVisible()
    const openLabel = (await dish.getAttribute('aria-label')) ?? ''
    const meal = openLabel.replace(/^Open \w+:\s*/, '').trim()
    expect(meal.length).toBeGreaterThan(0)

    await dish.click()
    const sheet = page.getByRole('dialog', { name: meal })
    await expect(sheet).toBeVisible()
    // The sheet offers the swap + remove actions for this day.
    await expect(
      sheet.getByRole('button', { name: 'Swap this dinner' }),
    ).toBeVisible()

    // Close via Escape (the Sheet's keyboard dismiss); the dialog goes away.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden({ timeout: 10_000 })
  })

  test('swaps a day for a pre-ranked alternative', async ({ page }) => {
    await onboardToBuiltWeek(page)

    // Open the swap chooser from a day's recipe sheet: tap the dish, then "Swap
    // this dinner" opens the alternatives pull-up (titled "Swap <Day>").
    const dish = firstDishButton(page)
    await expect(dish).toBeVisible()
    const openLabel = (await dish.getAttribute('aria-label')) ?? ''
    const day = openLabel.replace(/^Open (\w+):.*/, '$1')
    const meal = openLabel.replace(/^Open \w+:\s*/, '').trim()

    await dish.click()
    const sheet = page.getByRole('dialog', { name: meal })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Swap this dinner' }).click()

    const swapSheet = page.getByRole('dialog', { name: `Swap ${day}` })
    await expect(swapSheet).toBeVisible()

    // Pick the first alternative card. Each card's accessible name is the
    // alternative's meal title; tapping it persists the swap (a new plan
    // revision) and the sheet closes.
    const alternatives = swapSheet.locator('ul button')
    const altCount = await alternatives.count()
    if (altCount === 0) {
      // A fully-constrained seed can leave a day with no alternatives. The
      // chooser then shows the explicit empty message; assert that instead of
      // forcing a swap that has nothing to swap to.
      await expect(
        swapSheet.getByText('No other dinners left to swap in this week.'),
      ).toBeVisible()
      return
    }

    const newMeal = ((await alternatives.first().textContent()) ?? '').trim()
    await alternatives.first().click()

    // The swap committed: the sheet closes and the day's dish updated. We don't
    // assert the exact new name (the planner picks it) - only that the swap
    // sheet is gone and the week still renders a Monday row.
    await expect(swapSheet).toBeHidden({ timeout: 30_000 })
    await expect(page.locator('#day-Monday')).toBeVisible()
    // Sanity: we read a real alternative name off the card we tapped.
    expect(newMeal.length).toBeGreaterThan(0)
  })

  test('removes a day (eating out) and the card flips to "Add a dinner"', async ({
    page,
  }) => {
    await onboardToBuiltWeek(page)

    // Open a planned dish, then remove it via the "eating out" escape hatch.
    const dish = firstDishButton(page)
    await expect(dish).toBeVisible()
    const openLabel = (await dish.getAttribute('aria-label')) ?? ''
    const day = openLabel.replace(/^Open (\w+):.*/, '$1')
    const meal = openLabel.replace(/^Open \w+:\s*/, '').trim()

    await dish.click()
    await expect(page.getByRole('dialog', { name: meal })).toBeVisible()
    await page
      .getByRole('button', { name: 'Remove this dinner (eating out)' })
      .click()

    // The day is cleared: a new plan revision loads, the sheet closes, and that
    // day's card flips to the empty "Add a meal to <Day>" sticker + "Add a
    // dinner" row. Target the cleared day's anchor so we don't catch a
    // different already-empty day.
    const dayRow = page.locator(`#day-${day}`)
    await expect(
      dayRow.getByRole('button', { name: `Add a meal to ${day}` }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(dayRow.getByText('Add a dinner')).toBeVisible()
  })

  test('adds the built week to the shopping list and lands on the Cart tab', async ({
    page,
  }) => {
    await onboardToBuiltWeek(page)

    // The floating CTA reads "Add N items to shopping list" while items are
    // missing from the list; if the household already has everything it reads
    // "All added" and we route to the Cart via the tab instead.
    const addToList = page.getByRole('button', {
      name: /^Add \d+ items? to shopping list$/,
    })
    if (await addToList.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addToList.click()
    } else {
      await expect(
        page.getByRole('button', { name: 'All added' }),
      ).toBeVisible()
      await page.getByRole('link', { name: 'Cart' }).click()
    }

    // Landing on the Cart tab with the merged list rendered.
    await expect(page).toHaveURL(/\/shopping(\?|$)/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible()
  })
})
