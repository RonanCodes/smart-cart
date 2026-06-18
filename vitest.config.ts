import { defineConfig } from 'vitest/config'
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
  },
  resolve: {
    alias: {
      '#': new URL('./src', import.meta.url).pathname,
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
