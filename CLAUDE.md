# Smart Cart

Thin pointer file. The real context lives in:

- `CONTEXT.md`: what Smart Cart is + the shared domain language + hard rules.
- `docs/decisions.md`: locked decisions (no auto-buy, grounded recipes, Dutch-first) + open questions.
- `docs/PRD.md`: scope, the one flow we polish, sliced into agent-sized issues.
- `AGENTS.md`: TanStack/library skill mappings + the project-context section.

Hard rules: no autonomous purchasing (fill the basket, user checks out); meal
generation is grounded in the `recipe` table, never hallucinated; AH/Jumbo first.

Ship flow: feature branch off `main` → PR → squash-merge into `main` (auto-deploys).
Never push to `main` directly. Commits use emoji-conventional format. The pre-push
hook runs the full gate (`pnpm quality`).
