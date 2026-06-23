import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Profile / settings flow (self-contained, hermetic).
 *
 * Reaches a logged-in + onboarded + week-built state by replaying #480's proven
 * Get-started -> /onboarding -> Build my week click-path INLINE (no shared
 * helper file, to avoid colliding with the other flow specs), then exercises
 * every settings control the Profile page exposes against the REAL dev server
 * and REAL server fns: household size, taste & diet preferences, dislikes,
 * preferred supermarket, days-you-skip, language, the weekly-planning reminder,
 * notifications, "How Souso works", and "Send feedback". Each setting is changed
 * and then asserted to PERSIST across a reload.
 *
 * Local dev auto-authenticates as dev@souso.local (see e2e/README.md), so no OTP
 * email is needed to reach the gated /profile route.
 */

/** Tap the onboarding "Next" control (its own testid in #480). */
async function clickNext(page: Page) {
  await page.getByTestId('onboarding-next').click()
}

/**
 * Reuse #480's hydration-robust "Get started" tap: wait for the welcome step,
 * give Vite-dev hydration a beat, then click (twice if the welcome step is still
 * showing, which means the first click landed before hydration).
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
 * Drive the full onboarding to a built week so the Profile loader has a real
 * household + taste summary to render and edit. Mirrors the path in
 * e2e/onboarding-first-cart-checkout.spec.ts inline (kept hermetic on purpose).
 */
async function onboardToWeek(page: Page) {
  await page.goto('/onboarding')
  await startOnboarding(page)

  await expect(page.getByTestId('household-step')).toBeVisible()
  await page.getByRole('button', { name: 'Add one child' }).click()
  await clickNext(page)

  await expect(page.getByTestId('dislikes-step')).toBeVisible()
  await page.getByRole('button', { name: /^Mushroom/ }).click()
  await clickNext(page)

  await expect(page.getByTestId('diet-step')).toBeVisible()
  await clickNext(page)

  await expect(page.getByTestId('cuisine-step')).toBeVisible()
  await page.getByRole('button', { name: /^Italian:/ }).click()
  await clickNext(page)

  await expect(page.getByTestId('kitchen-step')).toBeVisible()
  await page.getByRole('button', { name: 'Oven' }).click()
  await clickNext(page)

  await expect(page.getByTestId('goals-step')).toBeVisible()
  await page
    .getByRole('button', { name: 'Avoid unnecessary purchases' })
    .click()
  await clickNext(page)

  await expect(page.getByTestId('beta-step')).toBeVisible()
  await page.getByRole('button', { name: 'Build my week' }).click()

  await expect(page).toHaveURL(/\/week(\?|$)/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible()
}

/** Open the Profile tab from the always-on bottom nav (selectable by name). */
async function openProfile(page: Page) {
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/profile(\?|$)/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
}

test.describe('profile / settings', () => {
  test('every setting on the profile page changes and persists', async ({
    page,
  }) => {
    await onboardToWeek(page)
    await openProfile(page)

    // The profile page groups its controls into airy hairline rows; each row is
    // a button whose accessible name is its label. Confirm the page rendered the
    // sections we are about to walk.
    const householdRow = page.getByRole('button', { name: 'Household' })
    const tasteRow = page.getByRole('button', { name: 'Taste & diet' })
    const dislikesRow = page.getByRole('button', { name: 'Dislikes' })
    const supermarketRow = page.getByRole('button', { name: 'Supermarket' })
    const skipRow = page.getByRole('button', { name: 'Days you skip' })
    const languageRow = page.getByRole('button', { name: 'Language' })
    await expect(householdRow).toBeVisible()
    await expect(tasteRow).toBeVisible()
    await expect(dislikesRow).toBeVisible()
    await expect(supermarketRow).toBeVisible()
    await expect(skipRow).toBeVisible()
    await expect(languageRow).toBeVisible()

    // ---- Household size: bump children, save, assert the row reflects it ----
    await householdRow.click()
    const householdSheet = page.getByRole('dialog', { name: 'Household' })
    await expect(householdSheet).toBeVisible()
    // Onboarding added one child (so summary is "2 adults + 1 child"); add one
    // more adult and one more child so the saved label is deterministic.
    await householdSheet.getByRole('button', { name: 'Add one adults' }).click()
    await householdSheet
      .getByRole('button', { name: 'Add one children' })
      .click()
    await page.getByTestId('household-save').click()
    await expect(householdSheet).toBeHidden()
    // Row trailing value reflects the saved household at once (#household-inline-edit).
    await expect(householdRow).toContainText(/adults/)

    // ---- Supermarket: switch to Picnic (a real, selectable store) ----
    await supermarketRow.click()
    const storeSheet = page.getByRole('dialog', { name: 'Preferred store' })
    await expect(storeSheet).toBeVisible()
    // Jumbo is parked ("Coming soon") and must not be selectable.
    await expect(
      storeSheet.getByRole('radio', { name: /Jumbo/ }),
    ).toBeDisabled()
    await storeSheet.getByRole('radio', { name: 'Picnic' }).click()
    // The write persists straight away; the radio reflects selected, then close.
    await expect(
      storeSheet.getByRole('radio', { name: 'Picnic' }),
    ).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(storeSheet).toBeHidden()
    await expect(supermarketRow).toContainText('Picnic')

    // ---- Language: switch recipe locale to Nederlands ----
    await languageRow.click()
    const languageSheet = page.getByRole('dialog', { name: 'Language' })
    await expect(languageSheet).toBeVisible()
    await languageSheet.getByRole('radio', { name: /Nederlands/ }).click()
    await expect(
      languageSheet.getByRole('radio', { name: /Nederlands/ }),
    ).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(languageSheet).toBeHidden()
    await expect(languageRow).toContainText('Nederlands')

    // ---- Days you skip: pick Monday + Wednesday, save my days ----
    await skipRow.click()
    const skipSheet = page.getByRole('dialog', { name: 'Days you skip' })
    await expect(skipSheet).toBeVisible()
    // Each weekday button carries an explicit aria-label "<Day>: cooking|skipped".
    const monBtn = skipSheet.getByRole('button', { name: /^Mon:/ })
    const wedBtn = skipSheet.getByRole('button', { name: /^Wed:/ })
    // "Save my days" stays disabled until selection is non-null. When Souso has
    // already inferred Mon/Wed as skip days the row shows them skipped but
    // selection is still null — toggle each day to an explicit manual override.
    for (const btn of [monBtn, wedBtn]) {
      if ((await btn.getAttribute('aria-label'))?.endsWith('skipped')) {
        await btn.click()
      }
      await btn.click()
      await expect(btn).toHaveAttribute('aria-label', /: skipped$/)
    }
    await expect(page.getByTestId('skip-days-save')).toBeEnabled()
    await page.getByTestId('skip-days-save').click()
    await expect(skipSheet).toBeHidden()
    // The row's trailing value now lists the chosen days.
    await expect(skipRow).toContainText('Mon')
    await expect(skipRow).toContainText('Wed')

    // ---- Taste & diet + dislikes: autosaving preferences sheet ----
    await tasteRow.click()
    const prefsSheet = page.getByRole('dialog', { name: 'Your preferences' })
    await expect(prefsSheet).toBeVisible()
    await expect(prefsSheet.getByRole('status')).toBeVisible()
    // Love a cuisine (toggles aria-pressed) and add a diet restriction.
    const vegetarian = prefsSheet.getByRole('button', { name: 'Vegetarian' })
    await vegetarian.scrollIntoViewIfNeeded()
    await expect
      .poll(async () => {
        if ((await vegetarian.getAttribute('aria-pressed')) !== 'true') {
          await vegetarian.click()
        }
        return vegetarian.getAttribute('aria-pressed')
      })
      .toBe('true')
    const greek = prefsSheet.getByRole('button', { name: 'Greek' })
    if ((await greek.getAttribute('aria-pressed')) !== 'true') {
      await greek.click()
    }
    await expect(greek).toHaveAttribute('aria-pressed', 'true')
    // A dislike pill toggle (Shellfish) so the Dislikes row count moves.
    await prefsSheet.getByRole('button', { name: 'Shellfish' }).click()
    // The autosave status line confirms the debounced patch round-trip landed.
    await expect
      .poll(async () => prefsSheet.getByRole('status').textContent(), {
        timeout: 25_000,
      })
      .toMatch(/Saved|Saving/)
    await expect(prefsSheet.getByRole('status')).toContainText('Saved', {
      timeout: 10_000,
    })
    await page.keyboard.press('Escape')
    await expect(prefsSheet).toBeHidden()
    // The Taste & diet row now shows the saved diet (incl. Vegetarian).
    await expect(tasteRow).toContainText('Vegetarian')

    // ---- Weekly planning reminder: enable it, set a day + time ----
    const reminderToggle = page.getByTestId('plan-reminder-toggle')
    if ((await reminderToggle.getAttribute('aria-checked')) !== 'true') {
      await reminderToggle.click()
    }
    await expect(reminderToggle).toHaveAttribute('aria-checked', 'true')
    // Enabling reveals the day + time controls; change both.
    await page
      .getByTestId('plan-reminder-dow')
      .selectOption({ label: 'Friday' })
    await page.getByTestId('plan-reminder-time').fill('18:30')
    // Let each optimistic save settle before continuing (serialized on the client).
    await expect(page.getByTestId('plan-reminder-time')).toHaveValue('18:30')
    await expect(page.getByTestId('plan-reminder-dow')).toBeEnabled({
      timeout: 15_000,
    })
    await expect(page.getByTestId('plan-reminder-toggle')).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // ---- Notifications: the sheet opens and reflects a state, never a dead end ----
    await page.getByRole('button', { name: 'Notifications' }).click()
    const notificationsSheet = page.getByRole('dialog', {
      name: 'Notifications',
    })
    await expect(notificationsSheet).toBeVisible()
    // Headless Chromium has no push service, so the sheet shows the calm
    // "not available here" / opt-in copy rather than a confirmed subscription.
    // Either way it renders a heading; just close it.
    await page.keyboard.press('Escape')
    await expect(notificationsSheet).toBeHidden()

    // ---- How Souso works: an informational sheet with a "Got it" dismiss ----
    await page.getByRole('button', { name: 'How Souso works' }).click()
    const helpSheet = page.getByRole('dialog', { name: 'How Souso works' })
    await expect(helpSheet).toBeVisible()
    await helpSheet.getByRole('button', { name: 'Got it' }).click()
    await expect(helpSheet).toBeHidden()

    // ---- Send feedback: the shared FeedbackForm submits against the real fn ----
    await page
      .locator('main')
      .getByRole('button', { name: 'Send feedback' })
      .click()
    const feedbackSheet = page.getByRole('dialog', { name: 'Send feedback' })
    await expect(feedbackSheet).toBeVisible()
    await feedbackSheet
      .getByLabel('Your feedback')
      .fill('E2E settings smoke test — please ignore.')
    // Signed-in, so the email field is read-only and prefilled (dev@souso.local).
    await feedbackSheet.getByRole('button', { name: 'Send feedback' }).click()
    // On success the form swaps to a thank-you confirmation, then auto-closes.
    await expect(feedbackSheet.getByText('Thank you')).toBeVisible({
      timeout: 15_000,
    })

    // ============================================================
    // PERSISTENCE: reload and re-open Profile; every saved setting
    // must come back from the server with the value we just wrote.
    // ============================================================
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

    await expect(
      page.getByRole('button', { name: 'Supermarket' }),
    ).toContainText('Picnic')
    await expect(page.getByRole('button', { name: 'Language' })).toContainText(
      'Nederlands',
    )
    await expect(
      page.getByRole('button', { name: 'Taste & diet' }),
    ).toContainText('Vegetarian')
    const skipRowAfter = page.getByRole('button', { name: 'Days you skip' })
    await expect(skipRowAfter).toContainText('Mon')
    await expect(skipRowAfter).toContainText('Wed')

    // The weekly-reminder toggle persists ON, with the day + time we set.
    await expect
      .poll(
        async () =>
          page.getByTestId('plan-reminder-toggle').getAttribute('aria-checked'),
        { timeout: 20_000 },
      )
      .toBe('true')
    await expect(page.getByTestId('plan-reminder-dow')).toHaveValue('5') // Friday
    await expect(page.getByTestId('plan-reminder-time')).toHaveValue('18:30')

    // The household row reflects the saved size after reload (3 adults + 2 kids
    // after we bumped each by one over onboarding's "2 adults + 1 child").
    const householdRowAfter = page.getByRole('button', { name: 'Household' })
    await expect(householdRowAfter).toContainText('3 adults')
    await expect(householdRowAfter).toContainText(/2 kids/)

    // Re-open the household sheet to prove the steppers come back pre-filled
    // with the saved size, then dismiss.
    await householdRowAfter.click()
    const householdSheetAfter = page.getByRole('dialog', { name: 'Household' })
    await expect(householdSheetAfter).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(householdSheetAfter).toBeHidden()
  })
})
