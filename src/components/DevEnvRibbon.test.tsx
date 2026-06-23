import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AppEnv } from '#/lib/app-env'

// The ribbon reads APP_ENV / IS_NOT_PROD_ENV, which are build-time constants
// baked from a Vite define. We can't flip a define mid-test, so we mock the
// module and re-import the component per case with the constants we want.
async function renderForEnv(env: AppEnv) {
  vi.resetModules()
  vi.doMock('#/lib/app-env', () => ({
    APP_ENV: env,
    IS_NOT_PROD_ENV: env !== 'production',
  }))
  const { DevEnvRibbon } = await import('./DevEnvRibbon')
  return render(<DevEnvRibbon />)
}

describe('DevEnvRibbon', () => {
  it('renders NOTHING on production', async () => {
    const { container } = await renderForEnv('production')
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
  })

  it('renders a DEV pill on the dev deployment', async () => {
    await renderForEnv('dev')
    const pill = screen.getByRole('status')
    expect(pill.textContent).toBe('DEV')
    expect(pill.getAttribute('aria-label')).toBe(
      'You are on the dev environment, not production',
    )
    cleanup()
  })

  it('renders a LOCAL pill on local pnpm dev', async () => {
    await renderForEnv('local')
    expect(screen.getByRole('status').textContent).toBe('LOCAL')
    cleanup()
  })
})
