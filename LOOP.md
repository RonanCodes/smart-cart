# Loop Design — Souso Daily Triage (L1)

Human-readable design doc for the agent loop on this repo. The loop does not replace code review or `pnpm quality` — it surfaces work on a schedule.

## Purpose

Every morning, scan GitHub Issues and open PRs to `develop`, then write a structured report to `STATE.md`. No code changes. No auto-fixes at L1.

## Pattern

**Daily Triage** — cadence `1d`, readiness **L1 (report-only)**.

## Primitives used

| Primitive  | How                                                    |
| ---------- | ------------------------------------------------------ |
| Scheduling | Claude Code `/loop 1d` (or Codex Automations)          |
| Skill      | `.claude/skills/loop-triage/SKILL.md`                  |
| Memory     | `STATE.md`, `loop-run-log.md`                          |
| Connectors | GitHub MCP or `gh` CLI — read issues/PRs/CI only at L1 |
| Worktrees  | Not used at L1                                         |
| Sub-agents | Not used at L1                                         |

## Intake (where work comes from)

1. GitHub Issues: labels `ready-for-agent`, `bug`; stale issues (7+ days no activity)
2. Open PRs targeting `develop`: CI `gate` status, review staleness
3. Prior `STATE.md` for continuity

## Output sections (STATE.md)

- **High Priority** — bugs, CI red, blockers
- **Ready for Agent** — labeled, scoped issues
- **Waiting on Human** — proposals, ownership conflicts
- **Triage Findings** — run metadata

## Souso-specific rules

- **Reproduce-first:** bugs like #401 must be flagged "needs failing test" — loop does not fix at L1
- **Ownership:** never auto-edit Nic-owned flows (`src/lib/pricing/*`, week generation internals)
- **Structured output only:** one-liners, no prose paragraphs (so L2 can parse STATE.md)

## Promotion path

| Level    | What changes                                                                                 |
| -------- | -------------------------------------------------------------------------------------------- |
| L1 (now) | Report to STATE.md only                                                                      |
| L2       | Worktree + implementer + verifier; PRs for trivial fixes; still no owned-flow edits          |
| L3       | Unattended fixes on allowlisted paths — requires one week of L1 accuracy + explicit approval |

## Schedule prompt (Claude Code)

```
/loop 1d "Run loop-triage skill. Read STATE.md and loop-budget.md. Scan GitHub issues and develop PRs. Update STATE.md with findings. Append one row to loop-run-log.md. L1: no code changes."
```

## References

- `loop-budget.md` — token limits and denylist
- `CONTRIBUTING.md` — promotion flow and quality gate
- `.claude/skills/reproduce-first-tdd/` — required before any L2 bug fix
