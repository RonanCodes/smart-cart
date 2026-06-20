import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // Workers AI + Vectorize have no local simulator, so the plugin would open
      // a REMOTE proxy session for them, which needs the developer's Cloudflare
      // account to have a workers.dev subdomain registered. That makes a fresh
      // clone fail to boot for any collaborator who hasn't onboarded Workers.
      // So remote bindings are OFF by default: dev runs fully local with no CF
      // account, and the app falls back gracefully (set-maths planning, demo
      // login) when AI/Vectorize are absent. Opt in with CF_REMOTE_BINDINGS=true
      // to exercise them against the real account.
      remoteBindings: process.env.CF_REMOTE_BINDINGS === 'true',
    }),
    tailwindcss(),
    // autoCodeSplitting is OFF deliberately. With it on, `pnpm dev` 500s on every
    // route with "ReferenceError: TSRSplitComponent is not defined" (the per-route
    // virtual split modules the router plugin emits in dev reference a symbol that is
    // never defined). It is NOT a version or plugin-order issue: the same versions and
    // plugin order work in our sibling app. Until the offending route pattern is found
    // (tracked as a follow-up), we disable dev auto-splitting so `pnpm dev` boots and
    // mobile Playwright verification works. Production build is unaffected (small app,
    // a few routes; vendor chunks still split).
    tanstackRouter({ target: 'react', autoCodeSplitting: false }),
    tanstackStart(),
    viteReact(),
  ],
})
