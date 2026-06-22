import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { FeedbackForm } from './FeedbackForm'

// The session is the collaborator the email field keys off: a signed-in email
// prefills + locks the field read-only; signed out, it is editable + optional.
const useSession = vi.fn()
vi.mock('#/lib/auth-client', () => ({
  useSession: () => useSession(),
}))

// The server write + the Sentry forward are stubbed so the render test stays a
// pure UI assertion (no network, no Sentry).
vi.mock('#/lib/app-feedback-server', () => ({
  submitFeedback: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('#/lib/observability-client', () => ({
  captureSentryFeedback: vi.fn(),
}))

beforeEach(() => {
  useSession.mockReset()
})

function emailInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('#feedback-email')
  if (!(el instanceof HTMLInputElement)) {
    throw new Error('email input not found')
  }
  return el
}

describe('FeedbackForm', () => {
  it('prefills + locks the email read-only when a session email exists', () => {
    useSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'nico@example.com' } },
    })
    const { container } = render(<FeedbackForm source="bubble" />)
    const email = emailInput(container)
    expect(email.value).toBe('nico@example.com')
    expect(email.disabled).toBe(true)
    expect(email.readOnly).toBe(true)
    expect(container.textContent).toContain('Sending as nico@example.com')
  })

  it('leaves the email editable + empty when signed out', () => {
    useSession.mockReturnValue({ data: null })
    const { container } = render(<FeedbackForm source="bubble" />)
    const email = emailInput(container)
    expect(email.value).toBe('')
    expect(email.disabled).toBe(false)
    expect(email.readOnly).toBe(false)
    // The "(optional, so we can reply)" hint shows only for the editable field.
    expect(container.textContent).toContain('optional, so we can reply')
  })

  it('always offers the optional phone field and screenshot option', () => {
    useSession.mockReturnValue({ data: null })
    const { container } = render(<FeedbackForm source="bubble" />)
    expect(container.querySelector('#feedback-phone')).toBeTruthy()
    expect(container.textContent).toContain('Add screenshot')
    expect(container.textContent).toContain('Open to a chat?')
  })
})
