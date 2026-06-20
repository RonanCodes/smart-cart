# PRD: Voice agent (VAPI)

Status: scoped, low priority. Issue: #17 (parent #8). Owner: Ronan.

## 1. What and why

Let a household run the weekly food loop hands-free, by phone, in plain Dutch or
English. The driving use case is the car: "swap Friday for something quick", "add
milk and bananas", "we're eating out Wednesday", then "fill my Albert Heijn cart".

Voice is a **transport**, not a second brain. Every spoken instruction maps onto an
action the app already does by chat or tap. The planner, replan engine, shopping
list, and basket logic stay in the app. VAPI listens, decides which app action to
call, calls it, and reads back the result.

This keeps the hard rules intact:

- **No autonomous purchasing.** Voice fills the basket and hands over a link. The
  user still opens the AH app and checks out. (`docs/decisions.md`, CONTEXT.md)
- **No hallucinated recipes.** Voice never invents a meal. Swaps go through the
  grounded planner / replan engine over the real catalogue.
- **Dutch-first.** The assistant is bilingual NL/EN and auto-detects per caller.

## 2. The assistant (already provisioned)

A VAPI assistant exists from the dashboard builder:

- Name: `Meal Plan Updater`
- Assistant ID: `0b54b5b2-f98d-4e94-b186-035a57d65065`
- Org ID: `b4f5930c-e149-4de5-8a90-4067aae065f8`
- Model: `claude-haiku-4-5-20251001` (Anthropic), maxTokens 250
- Voice: Vapi `Elliot` v2, `language: auto`
- Transcriber: Deepgram `nova-3`, `language: multi`
- System prompt: bilingual inbound agent, "must not claim success unless a tool
  confirms it", one question at a time, steer back to meal-plan updates.

This PRD turns that talking-only assistant into one that actually changes the
household's week and basket, by giving it tools that call the app.

## 3. Architecture (decided)

**VAPI custom tools call a single app webhook. The app owns all logic.**

```
Caller (phone)
  → VAPI assistant (intent + which tool)
    → tool call: POST https://<app>/api/vapi/tool
        header  X-Vapi-Secret: <VAPI_TOOL_SECRET>
        body    { message: { toolCalls: [{ name, arguments }] },
                  call: { customer: { number } } }
      → verify secret (constant-time)
      → household = lookupByPhone(customer.number)   // caller cannot pick a household
      → dispatch name → existing server logic
      → return { results: [{ toolCallId, result: "<spoken confirmation>" }] }
    ← assistant reads the result back to the caller
```

Why this shape:

- One endpoint, one secret, one dispatch table. Adding a flow is adding a tool +
  a case, not a new route.
- The `householdId` is **derived server-side from the caller's phone number**, never
  taken from the tool arguments, so a spoofed argument cannot reach another
  household's data. (Webhook security decision.)
- Each tool handler is a thin wrapper over an existing server fn
  (`replan-server`, `planner-server`, `shopping-server`, `staples-server`,
  `onboarding-server`), so voice and chat stay behaviourally identical and the
  replan tests already cover the core.

### Identity (decided)

Map a call to an account by **caller phone number**.

- Add `phone` (E.164, unique, nullable) to the `household` (or user) record, plus a
  verification flag. Set during onboarding or in profile ("add a phone for voice").
- `lookupByPhone(number)` resolves the household. No match, or unverified, → the
  assistant says it can't find an account for this number and offers to set one up
  (links to onboarding). It must never fall through to a default household.
- Verification: send a code by SMS once when the number is added; store
  `phone_verified_at`. (Open question: provider, see §8.)

### Security (decided)

- `X-Vapi-Secret` shared secret in an env binding `VAPI_TOOL_SECRET`, compared
  constant-time. Reject with 401 on mismatch or missing header.
- Per the diagnose canon, the verify path must never throw into the request; a bad
  secret is a clean 401, a lookup miss is a clean spoken decline.
- Rate-limit per caller number (abuse + cost guard on the LLM).
- Defer HMAC request signing to a follow-up if the shared secret proves too weak;
  noted, not built first.

## 4. Tool inventory (the actions VAPI can take)

Each tool is a VAPI custom tool whose server URL is `/api/vapi/tool`. Arguments are
what the model fills from the conversation; identity is always server-derived.

| Tool | Wraps | Args (model-filled) | Spoken result |
| --- | --- | --- | --- |
| `replan_week` | `replanWeek` (`replan-server`) | `instruction`, optional `focusedDay`, `week` (this/next) | what changed, or "couldn't do that yet" |
| `get_week` | `week-server` | `week` | reads back the current N dinners |
| `generate_cart` | `shopping-server` (basket build) | `store` (ah/jumbo) | "your AH basket is ready, N items" |
| `add_items` | `staples-server` search + add | `items[]` (e.g. milk, bananas) | what was added / not found |
| `send_cart_link` | basket deeplink + SMS | `channel` (sms/in-app) | "I've texted you the link" |
| `start_onboarding` | `onboarding-server` (voice variant) | `household_size`, `diet`, `dislikes[]`, `store` | confirms profile captured |

Notes:

- `generate_cart` and `send_cart_link` depend on the **AH basket fill (#14)** which
  is not built yet. Until it lands, `generate_cart` returns the shopping list and
  `send_cart_link` degrades to "your list is ready in the app".
- `start_onboarding` is the heaviest: a phone caller is unauthenticated and may have
  no household yet. The voice flow captures size/diet/dislikes/store into a pending
  profile keyed by the (verified) phone number, then the app picks it up on first
  sign-in. Full swipe taste intake stays in-app (you can't swipe by voice).

## 5. Cart hand-off (decided: both)

The AH cart needs a link the user taps to open the AH app/site with the basket.

- **Mid-call SMS:** when the basket is filled, send an SMS with the AH deeplink so
  it works hands-free in the car. Assistant says "I've texted you the link."
- **In-app:** the same "open cart" link is waiting in the app next time they open
  it (the basket row in `/shopping`).

Both share one source: a `buildCartLink(householdId, store)` helper that returns the
deeplink the in-app shopping view and the SMS both use. SMS provider is an open
question (§8); in-app link works with no provider.

## 6. Slices (vertical, agent-sized)

Ordered. Each is one PR. The first three are the spine; the rest layer on.

1. **Webhook skeleton + auth.** `POST /api/vapi/tool`, `VAPI_TOOL_SECRET` verify,
   `lookupByPhone`, dispatch table with a stub `ping` tool. Tests: 401 on bad
   secret, clean decline on unknown number. No real action yet.
2. **`phone` on household + verification.** Schema + migration, profile UI to add a
   number, one-time SMS code. (Couples to §8 provider choice.)
3. **`replan_week` tool.** Wire VAPI tool → webhook → `replanWeek`. The smallest
   real loop: phone in, "eating out Wednesday", week changes. Reuses replan tests.
4. **`get_week` + `add_items`.** Read back the week; add staples by voice.
5. **`generate_cart` (degraded).** Build the shopping list by voice; returns the
   list. Stands in until #14 lands.
6. **AH basket fill (#14) integration + `send_cart_link`.** Real AH deeplink,
   in-app link + mid-call SMS. **Blocked on #14.**
7. **`start_onboarding` by voice.** Pending-profile capture for new callers, picked
   up on first sign-in.

"Full plan-to-cart" (the chosen demo target) is slices 1 to 6 together: phone in,
replan, generate cart, add items, SMS the AH link. It is gated on #14; the rest of
the spine (1 to 5) ships and demos without it.

## 7. Out of scope

- Autonomous checkout / purchasing (hard rule, permanent).
- Recipe invention by voice (grounded catalogue only).
- Outbound calls / reminders by phone (this is inbound only).
- Swipe taste onboarding by voice (stays a visual in-app step).
- Languages beyond NL/EN.

## 8. Open questions

- **SMS provider.** The repo uses Resend for email; SMS needs a separate provider
  (Twilio, MessageBird) or VAPI's own SMS tool. Decides slices 2 and 6. Until
  resolved, phone verification and `send_cart_link` fall back to in-app only.
- **#14 timing.** Full plan-to-cart can't fully ship before AH basket fill exists.
  Slices 1 to 5 are independent; sequence #14, then slice 6.
- **Pending-profile model for new callers** (slice 7): exact shape of the
  phone-keyed pending profile and how the app claims it at first sign-in.
- **Cost guard.** Per-number rate limit values, and whether to cap call minutes.

## 9. Acceptance (MVP = slices 1 to 5)

- A verified caller phones the assistant and is matched to their household by number;
  an unknown number is declined cleanly (never falls through to another account).
- A bad / missing `X-Vapi-Secret` returns 401 and changes nothing.
- "Eating out Wednesday" (NL or EN) replans the week; the change is visible in the
  app and identical to the chat replan result.
- "Add milk and bananas" adds them (or reports what wasn't found).
- "Make my cart" builds the shopping list and reads back the item count.
- The assistant never claims success that a tool did not confirm.
