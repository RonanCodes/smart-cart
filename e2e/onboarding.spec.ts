import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Onboarding coverage, deeper than the #480 happy path.
 *
 * Self-contained on purpose (no shared helper file): each test drives the real
 * dev server through the real onboarding flow. Local dev auto-authenticates as
 * dev@souso.local, so the visitor is a signed-in "redo onboarding" re-entry —
 * the email/OTP phase is skipped and the last step's CTA reads "Build my week"
 * (requireAuth=false). That matches the #480 spec's click-path, reused inline
 * here to reach a built-week state when a scenario needs it.
 *
 * Selectors stay role/text-first (getByRole / getByText), never data-testid for
 * interaction — the step components expose accessible names (aria-label,
 * aria-pressed, the progressbar's aria-valuenow) that are stable to select on.
 * The step-container data-testids (household-step, diet-step, ...) are read-only
 * visibility anchors, reused from the components as #480 does.
 */

/** Advance to the next step via the shell's bottom CTA. */
async function clickNext(page: Page) {
  await page.getByTestId('onboarding-next').click()
}

/**
 * Walk past the welcome board onto the first step. Mirrors #480: Vite dev can
 * keep hydration a beat behind, so settle the page then click "Get started",
 * retrying once if the welcome board is still showing.
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
  await expect(page.getByTestId('household-step')).toBeVisible()
}

/** The shell's progressbar reports the 1-based step number via aria-valuenow. */
function progressBar(page: Page) {
  return page.getByRole('progressbar', { name: 'Onboarding progress' })
}

/** Add N children on the household step via the "Add one child" stepper. */
async function addChildren(page: Page, count: number) {
  const addChild = page.getByRole('button', { name: 'Add one child' })
  for (let i = 0; i < count; i++) await addChild.click()
}

test.describe('onboarding (deep coverage)', () => {
  test('household sizing: adults floor at 1, children add age inputs', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await startOnboarding(page)

    // Adults floor at 1: the draft defaults to 2 adults, so remove is live until
    // one tap reaches the floor; then "Remove one adults" disables.
    const removeAdult = page.getByRole('button', { name: 'Remove one adults' })
    await expect(removeAdult).toBeEnabled()
    await removeAdult.click()
    await expect(removeAdult).toBeDisabled()

    // Adding adults enables the remove control again.
    await page.getByRole('button', { name: 'Add one adults' }).click()
    await expect(removeAdult).toBeEnabled()

    // No children yet: the age inputs block is hidden until a child is added.
    await expect(page.getByTestId('children-ages')).toBeHidden()

    // Add two children -> two age inputs appear, each editable.
    await addChildren(page, 2)
    await expect(page.getByTestId('children-ages')).toBeVisible()
    await expect(page.getByLabel('Age of child 1')).toBeVisible()
    await expect(page.getByLabel('Age of child 2')).toBeVisible()

    await page.getByLabel('Age of child 1').fill('8')
    await expect(page.getByLabel('Age of child 1')).toHaveValue('8')

    // Removing a child trims its age row back out.
    await page.getByRole('button', { name: 'Remove one child' }).click()
    await expect(page.getByLabel('Age of child 2')).toBeHidden()
    await expect(page.getByLabel('Age of child 1')).toBeVisible()
  })

  test('select and deselect across every preference step', async ({ page }) => {
    await page.goto('/onboarding')
    await startOnboarding(page)
    await clickNext(page)

    // Dislikes: a suggested pill toggles selected -> deselected via aria-pressed.
    await expect(page.getByTestId('dislikes-step')).toBeVisible()
    const mushroom = page.getByRole('button', { name: /^Mushroom/ })
    await mushroom.click()
    await expect(mushroom).toHaveAttribute('aria-pressed', 'true')
    await mushroom.click()
    await expect(mushroom).toHaveAttribute('aria-pressed', 'false')
    // Re-select so a real dislike rides through to the planner.
    await mushroom.click()
    await clickNext(page)

    // Diet: multi-select grid, each option toggles on then off.
    await expect(page.getByTestId('diet-step')).toBeVisible()
    const vegetarian = page.getByRole('button', { name: 'Vegetarian' })
    await vegetarian.click()
    await expect(vegetarian).toHaveAttribute('aria-pressed', 'true')
    await vegetarian.click()
    await expect(vegetarian).toHaveAttribute('aria-pressed', 'false')
    await vegetarian.click()
    await clickNext(page)

    // Cuisine: a single tile cycles neutral -> like -> dislike -> neutral.
    await expect(page.getByTestId('cuisine-step')).toBeVisible()
    const italian = page.getByRole('button', { name: /^Italian:/ })
    await expect(italian).toHaveAttribute('data-state', 'neutral')
    await italian.click()
    await expect(italian).toHaveAttribute('data-state', 'like')
    await italian.click()
    await expect(italian).toHaveAttribute('data-state', 'hate')
    await italian.click()
    await expect(italian).toHaveAttribute('data-state', 'neutral')
    // Leave one liked so the planner has a cuisine signal.
    await italian.click()
    await clickNext(page)

    // Kitchen: multi-select appliance grid toggles.
    await expect(page.getByTestId('kitchen-step')).toBeVisible()
    const oven = page.getByRole('button', { name: 'Oven' })
    await oven.click()
    await expect(oven).toHaveAttribute('aria-pressed', 'true')
    await oven.click()
    await expect(oven).toHaveAttribute('aria-pressed', 'false')
    await oven.click()
    await clickNext(page)

    // Goals: full-width checklist rows toggle.
    await expect(page.getByTestId('goals-step')).toBeVisible()
    const lessMeat = page.getByRole('button', { name: 'Eat less meat' })
    await lessMeat.click()
    await expect(lessMeat).toHaveAttribute('aria-pressed', 'true')
    await lessMeat.click()
    await expect(lessMeat).toHaveAttribute('aria-pressed', 'false')
    await clickNext(page)

    // Beta step: the last screen before completion. Optional phone field is
    // present but never required (the CTA always advances).
    await expect(page.getByTestId('beta-step')).toBeVisible()
    await expect(page.getByText('one of our first beta testers')).toBeVisible()
  })

  test('beta-intent step: phone is optional and editable, never gates', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await startOnboarding(page)
    // Walk straight through every step to the terminal beta step.
    await clickNext(page) // household -> dislikes
    await clickNext(page) // dislikes -> diet
    await clickNext(page) // diet -> cuisine
    await clickNext(page) // cuisine -> kitchen
    await clickNext(page) // kitchen -> goals
    await clickNext(page) // goals -> beta

    await expect(page.getByTestId('beta-step')).toBeVisible()

    // The CTA reads "Build my week" on the last step (dev is a signed-in redo,
    // so the email/OTP phase is skipped) and is enabled with the phone blank —
    // nothing on this step is required.
    const cta = page.getByTestId('onboarding-next')
    await expect(cta).toHaveText('Build my week')
    await expect(cta).toBeEnabled()

    // The optional phone field accepts input.
    const phone = page.getByLabel(/Up for a quick chat/)
    await phone.fill('+31 6 12345678')
    await expect(phone).toHaveValue('+31 6 12345678')

    // Still enabled after editing the optional field.
    await expect(cta).toBeEnabled()
  })

  test('back navigation walks one step at a time and preserves state', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await startOnboarding(page)

    // Step 1 of N (household).
    await expect(progressBar(page)).toHaveAttribute('aria-valuenow', '1')
    await clickNext(page)

    // Step 2 (dislikes): pick Mushroom, then advance.
    await expect(page.getByTestId('dislikes-step')).toBeVisible()
    await expect(progressBar(page)).toHaveAttribute('aria-valuenow', '2')
    await page.getByRole('button', { name: /^Mushroom/ }).click()
    await clickNext(page)

    // Step 3 (diet): pick Vegan.
    await expect(page.getByTestId('diet-step')).toBeVisible()
    await expect(progressBar(page)).toHaveAttribute('aria-valuenow', '3')
    await page.getByRole('button', { name: 'Vegan' }).click()

    // Back once -> dislikes, one step at a time (NOT a jump out of the flow).
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByTestId('dislikes-step')).toBeVisible()
    await expect(progressBar(page)).toHaveAttribute('aria-valuenow', '2')
    // Mushroom is still selected: the draft survived the back move.
    await expect(
      page.getByRole('button', { name: /^Mushroom/ }),
    ).toHaveAttribute('aria-pressed', 'true')

    // Forward again -> diet, and the Vegan pick is still there.
    await clickNext(page)
    await expect(page.getByTestId('diet-step')).toBeVisible()
    await expect(progressBar(page)).toHaveAttribute('aria-valuenow', '3')
    await expect(page.getByRole('button', { name: 'Vegan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('full onboarding with a larger household lands on "Your week"', async ({
    page,
  }) => {
    await page.goto('/onboarding')
    await startOnboarding(page)

    // Household: two adults + one child (a bigger household than #480's path).
    await page.getByRole('button', { name: 'Add one adult' }).click()
    await addChildren(page, 1)
    await clickNext(page)

    await expect(page.getByTestId('dislikes-step')).toBeVisible()
    await page.getByRole('button', { name: /^Garlic/ }).click()
    await clickNext(page)

    await expect(page.getByTestId('diet-step')).toBeVisible()
    await page.getByRole('button', { name: 'Pescatarian' }).click()
    await clickNext(page)

    await expect(page.getByTestId('cuisine-step')).toBeVisible()
    await page.getByRole('button', { name: /^Japanese:/ }).click()
    await clickNext(page)

    await expect(page.getByTestId('kitchen-step')).toBeVisible()
    await page.getByRole('button', { name: 'Stovetop' }).click()
    await page.getByRole('button', { name: 'Air fryer' }).click()
    await clickNext(page)

    await expect(page.getByTestId('goals-step')).toBeVisible()
    await page
      .getByRole('button', { name: 'Pay less for my groceries' })
      .click()
    await clickNext(page)

    await expect(page.getByTestId('beta-step')).toBeVisible()
    await page.getByRole('button', { name: 'Build my week' }).click()

    // Completing onboarding builds the first week and routes to /week.
    await expect(page).toHaveURL(/\/week(\?|$)/, { timeout: 60_000 })
    await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible()
    await expect(page.getByTestId('week-label')).toBeVisible()
    await expect(page.locator('#day-Monday')).toBeVisible()
  })
})
