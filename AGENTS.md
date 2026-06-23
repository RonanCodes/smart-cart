<!-- intent-skills:start -->

# Skill mappings - load `use` with `pnpm dlx @tanstack/intent@latest load <use>`.

skills:

- when: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  use: "@tanstack/devtools#devtools-app-setup"
- when: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  use: "@tanstack/devtools#devtools-marketplace"
- when: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  use: "@tanstack/devtools#devtools-plugin-panel"
- when: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  use: "@tanstack/devtools#devtools-production"
- when: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  use: "@tanstack/devtools-event-client#devtools-bidirectional"
- when: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  use: "@tanstack/devtools-event-client#devtools-event-client"
- when: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  use: "@tanstack/devtools-event-client#devtools-instrumentation"
- when: "Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only."
  use: "@tanstack/devtools-vite#devtools-vite-plugin"
- when: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
  use: "@tanstack/router-core#router-core"
- when: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (\_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
  use: "@tanstack/router-core#router-core/auth-and-guards"
- when: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
  use: "@tanstack/router-core#router-core/code-splitting"
- when: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
  use: "@tanstack/router-core#router-core/data-loading"
- when: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
  use: "@tanstack/router-core#router-core/navigation"
- when: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
  use: "@tanstack/router-core#router-core/not-found-and-errors"
- when: "Dynamic path segments ($paramName), splat routes ($ / \_splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
  use: "@tanstack/router-core#router-core/path-params"
- when: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
  use: "@tanstack/router-core#router-core/search-params"
- when: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
  use: "@tanstack/router-core#router-core/ssr"
- when: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
  use: "@tanstack/router-core#router-core/type-safety"
- when: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
  use: "@tanstack/router-plugin#router-plugin"
- when: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
use: "@tanstack/virtual-file-routes#virtual-file-routes"
<!-- intent-skills:end -->

## Project context (read these first)

Before writing code or a PRD, read:

- `CONTEXT.md`: what Smart Cart is + the shared domain language (household, week menu, basket, recipe, adaptation) + the hard rules.
- `docs/decisions.md`: locked decisions (no auto-buy, grounded recipes, Dutch-first) and the open questions.
- `docs/PRD.md`: the scope + the one flow we polish, sliced into agent-sized issues.

Hard rules: no autonomous purchasing (we fill the basket, the user checks out); meal generation is grounded in the `recipe` table, never free-form/hallucinated; Dutch supermarkets (AH/Jumbo) first.

## Engineering principles (all agents)

The shared engineering thinking, so Claude, Codex, and Cursor all build the same
way. Each bullet points at the ADR or skill with the full reasoning. Claude reads
the long form in `.claude/skills/`; these summaries are the universal pickup.

- **Right tool per AI job.** Embeddings for matching (multilingual, NL/EN), an
  LLM only at decision points (replan intent, SKU rerank, substitution confirm),
  deterministic set-maths for anything reproducible (week ranking, hard
  allergy/diet filters, consolidation, cart-URL building). Embeddings are
  pre-computed offline and committed, never embedded at request time. See
  `docs/adr/0004`, skill `ai-safe-and-fast`.
- **No synonym/heuristic maps.** Synonym tables, substring matching,
  token-overlap, `CROSSLANG_EXCLUSION_GROUPS`, term-synonyms are all the same
  mistake: the embedding already gives cross-language semantics. Reach for the
  matcher, never a hand-maintained map. See `docs/adr/0004`, skill
  `ai-safe-and-fast`.
- **Safe by default.** Fail closed on missing secrets; hard filters
  (allergy/diet) stay deterministic and never trust the LLM; conservative rerank
  thresholds; wrong-type guards (Dutch compound traps); soft penalties over hard
  bans for preferences; degrade honestly with no hidden fallback. See skill
  `ai-safe-and-fast` (PRs #478, #479, #477, #331).
- **Bound AI work on request paths.** Workers have a hard ~128 MB / CPU cap and
  D1 has subrequest limits; "fans out per-item over a big input" is a memory/CPU
  risk. Bound, chunk, batch, and degrade rather than crash. This caused the
  `/shopping` 1101; the fix chunked the price compare to 25 lines at the
  call-site. See `docs/adr/0005`, skill `bounded-ai-on-request-paths`.
- **Reproduce-first TDD.** Any bug, Sentry issue, or user report starts with a
  failing test/eval that reproduces it, then the minimum fix, then refactor; the
  regression test ships with the fix. The three cart invariants and the evals are
  part of `pnpm quality`. See skill `reproduce-first-tdd` and `CLAUDE.md`.
- **Evals + tracing as gates.** Braintrust traces every AI call; the matcher
  eval, replan-agent eval, memory-classifier eval, and recall benchmark gate run
  in the pre-push gate so a regression turns it red. See `docs/adr/0006` and
  `docs/adr/0002`.
- **Ship flow + ownership.** Branch off fresh `origin/main`, one PR, the local
  gate (`pnpm quality`) is the real gate, squash-merge, never push `main`,
  emoji-conventional commits. The deep AI/data flows (onboarding-to-recipes,
  recipe-to-ingredients, the AH matcher in `src/lib/pricing/*`, add-to-cart, the
  Mollie tipping flow) are owned and locked by evals: work at the call-site, do
  not edit their internals. See skill `ship-flow-and-ownership`.

Full record: `docs/ai-architecture.md` (how the AI actually works),
`docs/adr/0001`..`0006`, `docs/matching.md`.

## AI SDK

This project uses the Vercel AI SDK. For patterns (streamText, generateObject, tool loops, prompt caching), load /ro:vercel-ai-sdk before adding or modifying any AI feature.

## Before you open a PR

Review your own diff against this checklist and fix every issue BEFORE opening
the PR (Claude has the same list in `.claude/skills/self-review-before-pr/`).
Run `git diff origin/main...HEAD` and walk all seven:

- **(a) Ownership.** Did I touch a Nic-owned internal? Owned flows:
  `src/lib/recsys/`, `src/lib/agent/` (onboarding to recipes, week generation);
  recipe-to-ingredient mapping; the AH matcher `src/lib/pricing/*`;
  `src/lib/cart-build.ts` / `cart-links*.ts` / `open-store-cart.ts` /
  `shopping/` (add-to-cart); `src/lib/mollie.ts` + `src/routes/api/mollie/`
  (Mollie tipping). Work at the call-site; do not edit these internals. Found a
  real bug? Write the failing test that reproduces it and raise it.
- **(b) Reproduce-first.** Is there a test that fails before the fix and passes
  after (or an eval case for an AI change)? No fix ships without it.
- **(c) No synonym/heuristic maps where embeddings belong.** No synonym tables,
  substring/token-overlap, or exclusion groups; the matcher's embeddings already
  give cross-language semantics.
- **(d) AI / heavy work on request paths is bounded.** Anything that fans out
  per-item on a request path must be chunked/batched and degrade, not crash
  (Workers memory/CPU cap).
- **(e) No slop / dead code / debug leftovers.** No `console.log`, commented-out
  blocks, unused imports, stray TODOs, or speculative abstractions.
- **(f) Copy rules.** No em-dashes or en-dashes; no AI-tell filler (delve,
  leverage, robust, seamless, streamline). Plainer sentence wins.
- **(g) Branch flow.** Feature PRs target **`develop`**, not `main` (only
  `develop` PRs into `main`). Branched off latest `origin/main`,
  emoji-conventional commits, `pnpm quality` green.

Full flow, the promotion gate, ownership map, and where things live:
**`CONTRIBUTING.md`**.
