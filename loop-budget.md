# Loop Budget — Souso

Token and safety limits for agent loops on this repo.

## Daily limits

- **Max tokens/day:** 500,000
- **On exceed:** pause schedulers, notify human (Slack `#loop-escalations` when configured)
- **Max sub-agent spawns per run:** 3 (L2+ only)
- **Active hours:** 08:00–20:00 Europe/Amsterdam

## Maturity

- **Current level:** L1 (report-only Daily Triage)
- **Next gate:** one week of accurate triage reports before enabling L2 on any pattern

## Denylist (no auto-edit without human)

- `src/lib/pricing/*` (Nic-owned matcher)
- Week generation / replan internals (see `ship-flow-and-ownership` skill)
- `.env`, secrets, `drizzle/migrations/*` (schema changes)
- `auth/`, payments, Mollie tipping

## Kill switch

- Delete or pause the `/loop` schedule in Claude Code
- Remove `ready-for-agent` label from issues to pull them out of the queue
