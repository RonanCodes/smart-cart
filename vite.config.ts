import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    // No remote-only bindings: D1 has a local simulator and AI/Vectorize were
    // removed (similarity is set-maths now), so dev runs fully local with no
    // Cloudflare account and no remote proxy session.
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
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
