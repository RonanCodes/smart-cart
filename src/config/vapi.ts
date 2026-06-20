/**
 * VAPI in-app voice config (client-side).
 *
 * The public key and assistant id are the only VAPI values that are safe in the
 * browser bundle (the public key starts a call but cannot touch the REST API),
 * so they ship as committed defaults here. A `VITE_`-prefixed env var overrides
 * either per environment if you ever need to.
 *
 * Why defaults and not env-only: `import.meta.env.VITE_*` is read by Vite from
 * `.env` files at build time, but this repo gitignores `.env*` (only `.dev.vars`
 * exists, which Vite does NOT load into `import.meta.env`). With no committed
 * source the values were `undefined` in the deployed/client bundle, so the voice
 * button errored immediately. Server-side secrets (token signing, webhook
 * secret) stay in `.dev.vars` / wrangler secrets — only these two public values
 * live here.
 */
export const VAPI_PUBLIC_KEY =
  (import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined) ??
  '6882ef04-0e7d-4ca4-ae7f-877c11ba0b5d'

export const VAPI_ASSISTANT_ID =
  (import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined) ??
  '0b54b5b2-f98d-4e94-b186-035a57d65065'
