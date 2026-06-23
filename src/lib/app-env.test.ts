import { describe, expect, it } from 'vitest'
import { resolveAppEnv, showDevBadge } from './app-env'

describe('resolveAppEnv', () => {
  it('maps "dev" to the dev environment', () => {
    expect(resolveAppEnv('dev')).toBe('dev')
  })

  it('maps "production" to production', () => {
    expect(resolveAppEnv('production')).toBe('production')
  })

  it('maps undefined (pnpm dev, no CLOUDFLARE_ENV) to local', () => {
    expect(resolveAppEnv(undefined)).toBe('local')
  })

  it('treats any unexpected value as local, never as dev or prod', () => {
    expect(resolveAppEnv('')).toBe('local')
    expect(resolveAppEnv('staging')).toBe('local')
    expect(resolveAppEnv('DEV')).toBe('local')
  })
})

describe('showDevBadge', () => {
  it('shows the badge on the deployed dev app', () => {
    expect(showDevBadge('dev')).toBe(true)
  })

  it('shows the badge on local pnpm dev', () => {
    expect(showDevBadge('local')).toBe(true)
  })

  it('NEVER shows the badge on production', () => {
    expect(showDevBadge('production')).toBe(false)
  })
})
