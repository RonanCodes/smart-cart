# PRD: Tip on add-to-cart (Mollie)

Status: scoped. Decisions: `docs/decisions.md` #15-#18. Owner: Ronan.

## 1. What and why

Souso's revenue is an **optional tip the user adds when they fill the basket**, taken
through Mollie. We never charge for the groceries themselves (AH/Jumbo take that
payment, hard rule #1), so this keeps "we are paid for the planning, not for buying
your groceries" intact.

The tip is also the product's most charming moment: a reactive Souso mascot that gets
visibly happier as you tip more. It turns a fee into brand personality.

## 2. The model (decided)

- **Free tier:** first 3 add-to-cart actions per month are free, no tip prompt.
- **After 3:** every add-to-cart shows the tip slider, **default 3%** of the basket
  total. The user can slide down to any whole percent (1% to 5%), or tap **"no tip"**.
- **Fee floor:** effective charge is `max(percent * basket, €0.50)` so small baskets
  don't cost us money on Mollie's per-transaction fee.
- **Repeat charges:** a Mollie **mandate** (recurring) so the second tip onward is
  one-tap, no full iDEAL redirect. (Demo can use a single iDEAL/card charge; mandate
  is the production path.)

## 3. Reward, never guilt (hard UX rule, #17)

The mascot reacts with **positive-only** emotion. We never punish declining.

| Tip          | Mascot asset                        | Vibe                                           |
| ------------ | ----------------------------------- | ---------------------------------------------- |
| No tip       | `souso-hat-plain` / `souso-2d-wave` | warm, neutral: "All good, here's your basket!" |
| 1%           | `souso-2d-wave`                     | happy                                          |
| 2%           | `souso-mascot-basket`               | chuffed                                        |
| 3% (default) | `souso-2d-cook`                     | beaming                                        |
| 4%           | `souso-hat-celebrate`               | thrilled                                       |
| 5%           | `souso-2d-celebrate`                | over the moon                                  |

- Slider snaps to whole percents; mascot crossfades as you drag.
- "No tip" is a real, unpunished tap target. No sad face, no disappointed copy.
- Because the default is on, the UI calls it an **optional default-on fee**, not a
  "tip", so it stays honest (anti-dark-pattern).

## 4. Architecture

Mollie, called directly with `fetch` from the Worker (the `@mollie/api-client` SDK is
not officially Workers-supported; the surface here is tiny). See `/ro:mollie`.

```
add-to-cart (free count exhausted)
  → show tip slider (default 3%, mascot reacts)
  → user confirms tip% (or no tip)
  → if tip > 0:  server: createPayment(amount = max(pct*basket, 0.50), mandate if exists)
                 → first time: redirect to _links.checkout (iDEAL) + create mandate
                 → later: charge the mandate, one-tap, no redirect
  → Mollie webhook POST /api/mollie/webhook (id only)
       → GET /v2/payments/{id}  (status is source of truth)
       → mark tip paid, decrement nothing (the basket hand-off is unaffected)
  → AH/Jumbo basket link proceeds regardless of tip outcome
```

Key rule (from `/ro:mollie`): the webhook body carries **only the payment id**; status
MUST be re-fetched from the API. Handler is idempotent (Mollie retries).

## 5. Data

- `tip_usage(household_id, period, free_count_used)` — the monthly free-3 counter.
- `tip_payment(id, household_id, basket_id, percent, amount, mollie_payment_id, status, created_at)`.
- `mollie_mandate(household_id, mandate_id, created_at)` — for one-tap repeats.

## 6. Slices (vertical, one PR each)

1. **Free-tier counter.** `tip_usage` table + "is this add-to-cart free?" check. Below 3
   → no prompt. Tests: 3 free, 4th prompts.
2. **Tip slider UI + mascot ladder.** Slider 1-5% + no-tip, default 3%, mascot crossfade.
   Positive-only states (UX rule #17). No payment yet (returns the chosen percent).
3. **Mollie charge (single payment).** `createPayment(max(pct*basket, €0.50))` → iDEAL
   redirect → webhook re-fetch → record `tip_payment`. The demo-ready slice.
4. **Mandate / one-tap repeat.** Create a mandate on first charge; later tips charge the
   mandate with no redirect.
5. **Fee floor + edge cases.** Min €0.50, no-tip path, failed/expired payment doesn't
   block the basket hand-off.

Demo target = slices 1 to 3 (free counter → reactive slider → one real Mollie charge).

## 7. Out of scope

- Charging for groceries (permanent, hard rule #1).
- Mandatory fees / any guilt or pressure UX (decision #17).
- Subscriptions/premium tiers (separate idea; this is per-basket tipping).

## 8. Open questions

- Free-tier reset: calendar month vs rolling 30 days; per-household or per-user (decisions
  #16 still-open).
- Does the 3% default survive user testing, or start lower?
- iDEAL minimum amount vs our €0.50 floor (confirm Mollie's per-method minimums).

## 9. Acceptance (MVP = slices 1 to 3)

- First 3 add-to-cart in a month show no tip prompt; the 4th shows the slider.
- Slider defaults to 3%, slides 1-5%, "no tip" is one tap and shows a warm (not sad)
  mascot.
- Choosing a tip creates a Mollie payment for `max(pct*basket, €0.50)`; on `paid`
  (re-fetched in the webhook) a `tip_payment` row is recorded.
- The AH/Jumbo basket link works regardless of whether the tip succeeds, fails, or is
  declined.
- No part of the flow punishes or pressures a no-tip choice.
