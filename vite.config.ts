import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Which deployment is this build for? Baked into the bundle as VITE_SOUSO_ENV so
// both server (SSR) and client read it with no request-time work, and so it is a
// frozen literal: prod can NEVER report "dev". Two signals decide it:
//
//   - CLOUDFLARE_ENV=dev  → "dev"        (set ONLY by deploy-dev.yml, dev.souso.app)
//   - any other `vite build` → "production"  (the prod deploy runs `pnpm build`
//                                  with CLOUDFLARE_ENV UNSET; a plain build is prod)
//   - `vite dev` (command === 'serve') → "local"  (`pnpm dev` on a laptop)
//
// IMPORTANT: the prod CI build leaves CLOUDFLARE_ENV unset, so we must NOT key
// "local" off "CLOUDFLARE_ENV is unset" — that would mislabel prod. We key it off
// `command` instead: only the dev SERVER is local; every BUILD is dev-or-prod.
function resolveSousoEnv(command: 'build' | 'serve'): string {
  if (process.env.CLOUDFLARE_ENV === 'dev') return 'dev'
  return command === 'build' ? 'production' : 'local'
}

export default defineConfig(({ command }) => ({
  // Bake the resolved environment in so import.meta.env.VITE_SOUSO_ENV is a
  // literal in the output bundle (no runtime lookup; dead branches tree-shake).
  define: {
    'import.meta.env.VITE_SOUSO_ENV': JSON.stringify(resolveSousoEnv(command)),
  },
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
}))
