import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AppEnv from './app-env'

// Wiring test for the DEV email markers: when isDevEnv() is true (the dev
// worker), every outbound email sent via email.ts must be obviously DEV. The
// From display name says "Souso (DEV)" (verified address unchanged) and the
// HTML body carries the amber DEV banner. When false (prod) the From is plain
// and the body has no marker. We mock isDevEnv per-test, mock Resend so nothing
// is actually sent, and capture the payload email.ts handed to Resend.send.

const send = vi.fn().mockResolvedValue({ error: null })
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: (payload: unknown) => send(payload) }
  },
}))
vi.mock('./env', () => ({ readEnv: async () => 'test-resend-key' }))

// isDevEnv is the only thing we flip; the other app-env exports keep their real
// (pure) behaviour so emailFromAddress / emailDevBanner build the real strings.
const isDevEnv = vi.fn<() => boolean>()
vi.mock('./app-env', async () => {
  const actual = await vi.importActual<typeof AppEnv>('./app-env')
  return { ...actual, isDevEnv: () => isDevEnv() }
})

async function loadEmailModule(dev: boolean) {
  // FROM / DEV_TEXT are read at module load, so reset modules and set the flag
  // BEFORE importing email.ts for each case.
  isDevEnv.mockReturnValue(dev)
  vi.resetModules()
  return import('./email')
}

describe('email.ts DEV markers (isDevEnv wiring)', () => {
  beforeEach(() => {
    send.mockClear().mockResolvedValue({ error: null })
  })

  it('isDevEnv true: From is DEV-marked (verified address kept) and the HTML body carries the DEV banner', async () => {
    const { sendApprovalEmail } = await loadEmailModule(true)
    await sendApprovalEmail('cook@example.com', 'https://souso.app/m/abc')

    const payload = send.mock.calls[0]![0] as { from: string; html: string }
    expect(payload.from).toContain('DEV')
    expect(payload.from).toContain('noreply@souso.app')
    expect(payload.html).toContain('dev.souso.app')
  })

  it('isDevEnv false: From is plain and the HTML body has no DEV marker', async () => {
    const { sendApprovalEmail } = await loadEmailModule(false)
    await sendApprovalEmail('cook@example.com', 'https://souso.app/m/abc')

    const payload = send.mock.calls[0]![0] as { from: string; html: string }
    expect(payload.from).toBe('Souso <noreply@souso.app>')
    expect(payload.html).not.toContain('dev.souso.app')
  })

  it('isDevEnv true: a text-only admin ping (new-user notice) carries the DEV line', async () => {
    const { sendNewUserNotice } = await loadEmailModule(true)
    await sendNewUserNotice('cook@example.com', 7, 'admin@souso.app', {
      source: 'linkedin',
      sourceOther: null,
      referrer: 'SPOCK',
    })

    const payload = send.mock.calls[0]![0] as { from: string; text: string }
    expect(payload.from).toContain('DEV')
    expect(payload.text).toContain('dev.souso.app')
    // The real attribution still threads through alongside the DEV marker.
    expect(payload.text).toContain('LinkedIn')
    expect(payload.text).toContain('SPOCK')
  })

  it('isDevEnv false: the text-only admin ping has no DEV marker', async () => {
    const { sendNewUserNotice } = await loadEmailModule(false)
    await sendNewUserNotice('cook@example.com', 7, 'admin@souso.app', null)

    const payload = send.mock.calls[0]![0] as { from: string; text: string }
    expect(payload.from).toBe('Souso <noreply@souso.app>')
    expect(payload.text).not.toContain('dev.souso.app')
  })
})
