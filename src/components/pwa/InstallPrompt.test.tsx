import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { InstallPrompt } from './InstallPrompt'
import { INSTALL_PROMPT_KEY } from '#/lib/pwa-install'

/**
 * Component-level smoke tests. The hard rules are covered in
 * `pwa-install.test.ts`; here we only check that the effect wiring shows the
 * card for an iOS Safari UA after the delay, and that we never show when
 * standalone. We drive timers manually so nothing depends on first paint.
 */

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  })
}

function setStandalone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches, addEventListener() {}, removeEventListener() {} }),
    configurable: true,
    writable: true,
  })
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    setUserAgent(IPHONE_SAFARI)
    setStandalone(false)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not show on first paint', () => {
    render(<InstallPrompt />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the iOS Safari guidance after the delay', () => {
    render(<InstallPrompt />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(
      screen.getByRole('dialog', { name: /add souso to your home screen/i }),
    ).toBeTruthy()
    expect(screen.getByText(/add to home screen/i)).toBeTruthy()
  })

  it('never shows when already standalone', () => {
    setStandalone(true)
    render(<InstallPrompt />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stamps engagement in storage on mount', () => {
    render(<InstallPrompt />)
    const raw = window.localStorage.getItem(INSTALL_PROMPT_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).engagedAt).toBeGreaterThan(0)
  })
})
