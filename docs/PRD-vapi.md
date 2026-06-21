# PRD: Voice agent (VAPI), in-app embedded

Status: scoped. Issue: #17 (parent #8). Owner: Ronan.

## 1. What and why

"Talk to Souso" inside the app: tap a button and have a live, two-way voice
conversation that runs every flow, onboarding, meal planning, replan, generate
cart, add items. Bilingual NL/EN, auto-detected.

Voice is a **transport**, not a second brain. Every spoken instruction maps onto an
action the app already does by chat or tap. The planner, replan engine, shopping
list, and basket logic stay in the app. VAPI listens, decides which tool to call,
calls it, and reads the result back.

Hard rules intact:

- **No autonomous purchasing.** Voice fills the basket and hands over the AH link;
  the user still checks out. (`docs/decisions.md` #1)
- **No hallucinated recipes.** Voice never invents a meal; swaps go through the
  grounded planner / replan engine over the real catalogue.
- **Dutch-first.** Bilingual NL/EN, auto-detected.

## 2. Channel decision (the pivot)

**Primary + only channel for now: in-app WebRTC via `@vapi-ai/web`.** A live voice
call inside the app, no phone number, no telephony cost, works on web + mobile PWA
(HTTPS + mic permission + a tap to start). Uses the **public** key + assistant id
(both browser-safe). You still pay VAPI's per-minute (model + STT + TTS) but there is
no phone leg.

Phone channels are explicitly deferred (see §7): inbound phone and outbound "Souso
rings you Sunday at 6" both need a provisioned number + per-minute telephony. The
proactive moment is reachable later for cheap via **push notification → tap → in-app
call**, no number required.

Why this is the right first build: zero provisioning, works with the keys we have
today, identity comes free from the signed-in session, and it demos the entire
experience.

## 3. The assistant (already provisioned)

- Name: `Meal Plan Updater`, Assistant ID `0b54b5b2-f98d-4e94-b186-035a57d65065`
- Org ID `b4f5930c-e149-4de5-8a90-4067aae065f8`
- Model `claude-haiku-4-5-20251001`, Voice Vapi `Elliot` v2 (`language: auto`),
  Transcriber Deepgram `nova-3` (`language: multi`)
- System prompt: bilingual agent, "must not claim success unless a tool confirms it",
  one question at a time.

This PRD gives that assistant tools that call the app, and embeds it in the client.

## 4. Architecture

Two halves: the browser starts the call; VAPI calls our tool webhook server-to-server
for each action.

```
In-app: <VoiceButton/> → new Vapi(PUBLIC_KEY) → vapi.start(ASSISTANT_ID, {
            metadata: { token: <short-lived signed session token> } })
         ↕ live WebRTC voice
VAPI assistant decides intent → tool call
  → POST https://souso.app/api/vapi/tool        (server-to-server, NOT the browser)
      header  X-Vapi-Secret: <VAPI_TOOL_SECRET>
      body    { message: { toolCalls:[{ id, name, arguments }] },
                call: { metadata: { token } } }
    → verify X-Vapi-Secret (constant-time)
    → householdId = verifySessionToken(call.metadata.token)   // trustworthy, server-minted
    → dispatch name → existing server fn
    → return { results:[{ toolCallId, result:"<spoken confirmation>" }] }
  ← assistant speaks the result
```

### Identity (the key change from the phone design)

The tool webhook is a **server-to-server** call from VAPI; it does NOT carry the
app's session cookie. So we bind identity at call-start:

1. Before `vapi.start`, the client calls a server fn that mints a **short-lived
   signed token** (JWT/HMAC) for the signed-in household (a few minutes TTL).
2. The token is passed as call `metadata` to `vapi.start`.
3. The tool webhook reads `call.metadata.token`, **verifies the signature
   server-side**, and derives `householdId` from it. Never trust a `householdId`
   sent in tool arguments (a client value is spoofable); only the signed token is
   authoritative.

This replaces the phone-number lookup entirely (no `phone` field, no SMS
verification needed for in-app). Phone lookup returns only if/when we build the
phone channel.

> Verify against a live payload: the exact path VAPI echoes start-time metadata into
> the tool-call webhook (`call.metadata` vs `call.assistantOverrides.metadata` vs a
> top-level field) differs across versions. Log the first real payload and read
> defensively. Pattern is sound regardless: signed token in, verify out.

### Security

- `X-Vapi-Secret` shared secret (`VAPI_TOOL_SECRET`), constant-time compare, 401 on
  mismatch/missing. So only VAPI can reach the webhook.
- Session token is short-lived + signed; an expired or bad token → clean spoken
  decline, never a fallback to a default household.
- Verify path never throws into the request (diagnose canon): bad secret = 401, bad
  token = decline.
- One endpoint, one secret, one dispatch table. Adding a flow = a tool + a case.

## 5. Tool inventory (the actions VAPI can take)

Each is a VAPI custom tool with server URL `/api/vapi/tool`. Arguments are
model-filled; identity is always from the signed token.

| Tool               | Wraps                            | Args (model-filled)                             | Spoken result                           |
| ------------------ | -------------------------------- | ----------------------------------------------- | --------------------------------------- |
| `start_onboarding` | `onboarding-server`              | `household_size`, `diet`, `dislikes[]`, `store` | confirms profile captured               |
| `get_week`         | `week-server`                    | `week` (this/next)                              | reads back the N dinners                |
| `replan_week`      | `replanWeek` (`replan-server`)   | `instruction`, optional `focusedDay`, `week`    | what changed, or "can't do that yet"    |
| `add_items`        | `staples-server` search + add    | `items[]` (e.g. milk, bananas)                  | what was added / not found              |
| `generate_cart`    | `shopping-server` (basket build) | `store` (ah/jumbo)                              | "your basket is ready, N items"         |
| `open_cart`        | `buildCartLink`                  | `store`                                         | "your AH cart link is ready in the app" |

### Memory tools (shared with the chat agent)

The voice assistant shares its memory surface with the in-app chat agent
(`src/lib/agent/tools.ts`), so both behave identically. Two tools, both routed
through `dispatchVapiTool` -> `dispatchAgentTool` with `source: 'voice'`:

| Tool            | Wraps                                  | Args (model-filled)                                           | Spoken result                                |
| --------------- | -------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `recall_memory` | `buildMemoryContext` (`memory-server`) | none                                                          | what we remember + this/last week + feedback |
| `remember`      | `rememberFact` (`memory-server`)       | `content`, `kind`, `cuisine?`, `term?`, `polarity?`, `scope?` | confirms the fact was saved                  |

The model fills the structured `remember` fields itself (it IS the LLM), so there
is no extra classification call. The classic nuance to respect: **"not pizza every
week"** is `kind: "variety"`, `polarity: "neutral"`, `cuisine: "pizza"` — a
frequency wish, never a dislike or a ban.

> Dashboard step (cannot be done from the repo): register `recall_memory` and
> `remember` as custom tools on assistant `0b54b5b2-f98d-4e94-b186-035a57d65065`
> with server URL `/api/vapi/tool` and the schemas above (mirroring
> `rememberInputSchema` in `src/lib/agent/tools.ts`). Update the assistant's system
> prompt to: "Call `recall_memory` before acting so you know the household's tastes
> and what they ate recently. When you learn something durable, call `remember`.
> Treat 'not X every week' as a variety wish, not a dislike."

Notes:

- All four flows run through voice: **onboarding** (`start_onboarding`), **meal
  planning** (`get_week` + `replan_week`), **generate cart** (`generate_cart`),
  **add items** (`add_items`).
- **Memory** is shared with the chat agent (`recall_memory` + `remember`).
- The **swipe taste step stays visual** in onboarding (you can't swipe by voice);
  voice captures size/diet/dislikes/store and hands off to the swipe deck in-app.
- `generate_cart` / `open_cart` depend on **AH basket fill (#14)**, not built yet.
  Until it lands, `generate_cart` returns the shopping list and `open_cart` says the
  list is ready in the app. In-app delivery only (no SMS needed, the app is open).

## 6. Slices (vertical, one PR each)

1. **Tool webhook + auth.** `POST /api/vapi/tool`, `VAPI_TOOL_SECRET` verify, signed
   session-token mint + verify, dispatch table with a stub `ping` tool. Tests: 401 on
   bad secret, decline on bad/expired token. No UI yet.
2. **In-app `<VoiceButton/>`.** `@vapi-ai/web`, mints the token, `vapi.start` with it,
   call-start/end + transcript events, mic-permission + tap-to-start UX. Lands on the
   week view. "Talk to Souso" works end to end against the stub tool.
3. **`replan_week`.** First real flow: speak "eating out Wednesday", week changes,
   identical to chat replan. Reuses replan tests.
4. **`get_week` + `add_items`.** Read the week back; add staples by voice.
5. **`generate_cart` (degraded).** Build the shopping list by voice; returns the list
   until #14 lands.
6. **`start_onboarding`.** Voice captures size/diet/dislikes/store, hands to the swipe
   deck.
7. **AH basket fill (#14) + `open_cart`.** Real deeplink + in-app cart link.
   **Blocked on #14.**

**Demo target = slices 1 to 5**: tap "Talk to Souso", replan the week, add items,
generate the list, all by voice, no phone number, no #14.

## 7. Out of scope / deferred

- **Phone channels** (inbound number, outbound "Souso calls you"). Deferred: need a
  provisioned number + telephony cost. The proactive moment can come later as
  **push → tap → in-app call** for no telephony cost.
- Autonomous checkout / purchasing (hard rule, permanent).
- Recipe invention by voice (grounded catalogue only).
- Swipe taste onboarding by voice (stays visual).
- SMS delivery (only needed for the phone channel; in-app delivers in the app).
- Languages beyond NL/EN.

## 8. Open questions

- **#14 timing.** `generate_cart` / `open_cart` degrade until AH basket fill exists.
  Slices 1 to 6 are independent of it.
- **Token shape + TTL.** JWT vs HMAC, exact TTL (a few minutes), and where VAPI
  surfaces start-time metadata in the webhook (verify live, §4).
- **Cost guard.** Per-session minute cap; VAPI per-minute spend during a long call.
- **Mobile mic UX.** iOS Safari / PWA gesture + permission flow; confirm on a device.

## 9. Acceptance (MVP = slices 1 to 5)

- Tapping "Talk to Souso" in the app starts a live voice call (web + mobile PWA), no
  phone number.
- A bad / missing `X-Vapi-Secret` returns 401 and changes nothing; a bad/expired
  session token is declined cleanly (never falls through to another household).
- The signed-in household is correctly bound to the call via the signed token; tool
  arguments cannot select a different household.
- "Eating out Wednesday" (NL or EN) replans the week, visible in the app and identical
  to the chat replan result.
- "Add milk and bananas" adds them (or reports misses).
- "Make my cart" builds the shopping list and reads back the count.
- The assistant never claims success a tool did not confirm.
