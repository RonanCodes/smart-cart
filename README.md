<div align="center">
  <img src="./public/souso-mark.svg" alt="Souso, your sous chef" width="360" />
  <h1>Souso</h1>
  <p><strong>Never wonder what's for dinner again.</strong></p>
  <p>
    <a href="https://smartcart.ronanconnolly.dev">smartcart.ronanconnolly.dev</a>
  </p>
</div>

---

## What it is

Smart Cart is an AI household food planner. It learns how your household eats
(diet, allergies, taste, budget, portions), plans your week, and fills a
ready-to-order basket at Albert Heijn or Jumbo in under a minute. You just check
out.

The difference from a recipe app or a price-comparison tool: those stop at
_suggesting_. Smart Cart plans the week and builds the basket, and the whole plan
adapts when life changes. One loop that fits you better every week:

```
learn  →  plan  →  fill basket  →  cook & rate
   ▲                                    │
   └────────────────────────────────────┘
```

**Trust framing:** we never touch your money. Smart Cart plans and fills the
basket; you check out. No autonomous purchasing, by design.

## Stack

| Layer     | Choice                                             |
| --------- | -------------------------------------------------- |
| Framework | TanStack Start (SSR + server routes) on React 19   |
| Styling   | Tailwind v4 + shadcn-style components (cva)        |
| Database  | Cloudflare D1 (SQLite) via Drizzle                 |
| Auth      | Better Auth: passwordless email OTP (Resend)       |
| Email     | Resend                                             |
| AI        | Vercel AI SDK (Anthropic primary, OpenAI / Google) |
| Host      | Cloudflare Workers (`smartcart.ronanconnolly.dev`) |

## Run it locally

```bash
npm run init     # install, scaffold .dev.vars, migrate + seed the local D1
npm run start    # http://localhost:3000
```

`init` is idempotent (safe to re-run) and needs [pnpm](https://pnpm.io)
installed (`corepack enable && corepack prepare pnpm@latest --activate`). It
generates a local `BETTER_AUTH_SECRET` for you and leaves the optional keys
blank, so the app runs out of the box: meal planning is set-maths and sign-in
needs no email provider. To sign in, enter any email and click **"Skip email"**
on the sign-in page (it returns the one-time code directly). To enable real OTP
emails and AI replan, fill in `RESEND_API_KEY` and an LLM key (e.g.
`ANTHROPIC_API_KEY`) in `.dev.vars`.

Vectorize (similar-meal swaps) has no local emulation, so that one feature is
inert locally; everything else works against the seeded D1.

## Scripts

| Command                  | Does                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `npm run init`           | One-shot local setup (install, `.dev.vars`, migrate + seed)   |
| `npm run start`          | Local dev server (alias of `pnpm dev`)                        |
| `pnpm quality`           | The full local gate: format + lint + typecheck + build + test |
| `pnpm db:generate`       | Generate a Drizzle migration from `src/db/schema.ts`          |
| `pnpm db:migrate:local`  | Apply pending migrations to the local D1                      |
| `pnpm reseed:d1 --local` | Seed the local D1 recipe catalogue                            |
| `pnpm deploy`            | Build + deploy the Worker                                     |

## Conventions

- **Never push to `main`.** Feature branch → PR → **squash-merge**.
- The **pre-push hook runs the full local gate** (`pnpm quality`). Green push = good.
- Commits use emoji-conventional format (`✨ feat:`, `🐛 fix:`, `📝 docs:` …),
  enforced by commitlint.
- Routes are file-based under `src/routes`. Server routes use the `server.handlers`
  option (see `src/routes/api/health.ts`).

## Layout

```
src/
  routes/            file-based routes (pages + /api/* server routes)
  components/ui/      shadcn-style primitives (button, card, input, badge)
  db/                d1 client + drizzle schema (household, meal_plan, auth)
  lib/               auth (Better Auth), email (Resend), models (AI SDK), env
  styles.css         design tokens (the brand palette)
drizzle/migrations/  generated D1 SQL migrations
```

The product knowledge (vision, features, pitch, moat) lives in the
`llm-wiki-smart-cart` vault.
