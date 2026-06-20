import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
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
    // TanStack Start already includes the router code-splitter internally. Do
    // NOT also add the standalone `tanstackRouter()` plugin: with both present,
    // every route file is run through `compile-reference-file` twice and the
    // injected HMR `hot` binding is declared twice, so dev 500s on every route
    // with "Duplicate declaration hot". The earlier "TSRSplitComponent is not
    // defined" 500s were the same double-splitter conflict, not code splitting
    // itself, so Start's built-in splitter runs with its defaults here.
    tanstackStart(),
    viteReact(),
  ],
})
