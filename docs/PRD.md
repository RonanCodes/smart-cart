# PRD: Smart Cart (draft, fill on the features call)

Read `CONTEXT.md` and `docs/decisions.md` first. This is the scaffold; the team
fills the TODOs on the call, then we slice it into vertical issues for an agent.

## 1. Problem

Every week a household has to decide what to eat, account for everyone's
diet/allergies/taste, build a list, and buy it. The mental load happens before
checkout, and people skip cooking because deciding + shopping is too much effort.

## 2. Who it's for

Primary: busy Dutch households (couples, families) who already shop at AH or Jumbo.
TODO on call: narrow the demo persona (e.g. a working couple, family of four).

## 3. The outcome

A household tells us about itself once and never has to plan a week of dinners or
build a shopping list again. Every week: here are your dinners, here is your basket.

## 4. Scope: the one flow we polish

Onboard (3-4 questions) → generate the week menu → fill a ready-to-order basket →
adapt on a plain-language request.

TODO on call, pick the demo path and lock it:

- [ ] Onboarding questions (which 3-4)?
- [ ] Week menu: dinners only? swap a meal?
- [ ] Basket: which store first (AH / Jumbo)? price compare in the demo?
- [ ] Adaptation: which one wow-replan do we show?

## 5. Out of scope (for the demo)

- Autonomous purchasing / checkout (locked out, see decisions.md).
- Fridge scan, multi-week history, payments, native app. Later.

## 6. The demo moment (target: under 90 seconds, live)

Onboard a volunteer in seconds → a personalised week appears → a filled AH/Jumbo
basket appears with a price → one spoken change ("we're out Wednesday") replans it
live. TODO: write the exact 90-second script (see the pitch concept in the vault).

## 7. How we know it works

- A real person can be onboarded and get a sensible, non-hallucinated week in < 1 min.
- The basket maps to real AH/Jumbo products.
- A plain-language change visibly replans the week.

---

## Slices (fill after the call, then open one issue each)

Each slice is one vertical step, small enough for an agent to finish in one go:

- [ ] Onboarding form → writes the `household` profile
- [ ] Week-menu generation from the `recipe` catalogue (grounded, no hallucination)
- [ ] Render the week + swap-a-meal
- [ ] Basket build from a week menu (map to store products) + price
- [ ] Natural-language replan
- [ ] The pitch/demo polish pass
