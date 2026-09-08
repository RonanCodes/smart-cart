---
name: loop-triage
description: Daily Triage for Souso (smart-cart). Scan GitHub issues and develop PRs, write structured findings to STATE.md. L1 report-only — no code changes. Use when running the daily loop or when asked to triage the backlog.
---

# Loop Triage — Souso

Report-only triage for the smart-cart repo. **Do not modify application code.** Update only `STATE.md` and append to `loop-run-log.md`.

## Before you start

1. Read `STATE.md` for prior findings and prune merged/closed items
2. Read `loop-budget.md` for denylist and maturity level (L1 = report only)
3. Read `LOOP.md` for section names and output format

## What to fetch

Use GitHub MCP or `gh` CLI:

### Issues

- Open issues with label `ready-for-agent`
- Open issues with label `bug`
- Open issues with no activity for 7+ days (flag as stale)
- New unlabeled issues (suggest triage in **Waiting on Human**)

### Pull requests

- Open PRs targeting `develop`
- CI: `gate` job status (required check)
- PRs not updated in 3+ days → flag in **High Priority** or **For Review** section

## Output format (STATE.md)

Use exactly these sections. Each item is a **one-liner**:

```markdown
## High Priority

- #401: RangeError on /week — bug, reproduce-first required

## Ready for Agent

- #444: Admin UX overhaul — ready-for-agent

## Waiting on Human

- #408: Beta-tester flow — proposal not confirmed

## Triage Findings

- Last run: <ISO timestamp>
- Open issues scanned: <count>
- Open PRs to develop: <count>
```

**Rules:**

- No paragraphs. No commentary. Just signal.
- Bugs → always note "reproduce-first required"
- Issues touching owned flows (`src/lib/pricing/*`, week generation) → note "ownership review required"
- Do NOT close, label, or comment on issues at L1

## Constraints (L1)

- Do NOT modify any code outside `STATE.md` and `loop-run-log.md`
- Do NOT create branches or PRs
- Do NOT merge or push
- Exit early if nothing changed since last run (append log row either way)

## Log row (loop-run-log.md)

Append one table row per run:

`| 2026-06-26T08:00Z | daily-triage | 2m | 12 | report-only | ~45k |`

## Escalation

If you find something that looks like a production incident (auth broken, data loss), write it under **High Priority** and stop — do not attempt fixes.
