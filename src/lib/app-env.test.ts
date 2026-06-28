import { describe, expect, it } from 'vitest'
import {
  resolveAppEnv,
  showDevBadge,
  emailFromAddress,
  emailDevBanner,
  emailDevTextBanner,
} from './app-env'

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

// Dev-email markers: in dev, every outbound email must be obviously DEV so an
// admin never mistakes a dev test for a real prod signup. The From display name
// becomes "Souso (DEV)", the body carries an amber DEV banner, and text-only
// pings carry a plain-text DEV line. The verified souso.app domain + noreply@
// address are KEPT in both cases so deliverability / DKIM is unchanged. Prod
// output must carry NONE of these markers.
describe('emailFromAddress', () => {
  it('marks the From display name DEV in dev, keeping the verified address', () => {
    const from = emailFromAddress(true)
    expect(from).toContain('DEV')
    // Domain + address unchanged so DKIM/SPF deliverability is identical.
    expect(from).toContain('noreply@souso.app')
  })

  it('is the plain Souso From in prod (no DEV marker)', () => {
    const from = emailFromAddress(false)
    expect(from).toBe('Souso <noreply@souso.app>')
    expect(from).not.toContain('DEV')
  })
})

describe('emailDevBanner', () => {
  it('renders an amber DEV banner in dev', () => {
    const banner = emailDevBanner(true)
    expect(banner).toContain('DEV')
    expect(banner).toContain('dev.souso.app')
  })

  it('is empty in prod so prod email bodies are unchanged', () => {
    expect(emailDevBanner(false)).toBe('')
  })
})

describe('emailDevTextBanner', () => {
  it('prepends a plain-text DEV line in dev', () => {
    const text = emailDevTextBanner(true)
    expect(text).toContain('DEV')
    expect(text).toContain('dev.souso.app')
  })

  it('is empty in prod', () => {
    expect(emailDevTextBanner(false)).toBe('')
  })
})
