import { defineConfig, configDefaults } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'

/**
 * Dedicated Vitest config. The app's vite.config.ts loads the Cloudflare and
 * TanStack Start plugins, which assume a Worker build environment and throw when
 * Vitest spins up its own server. Tests only need React + jsdom, so we define a
 * minimal config here; Vitest prefers vitest.config.ts over vite.config.ts.
 */
export default defineConfig({
  plugins: [viteReact()],
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    // Never pick up tests inside isolated agent worktrees (.claude/worktrees/*).
    // `e2e/*.spec.ts` are Playwright specs (a Playwright `test.describe` throws
    // under the Vitest runner) — they run via `playwright test`, not here (#480).
    exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '#': new URL('./src', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
