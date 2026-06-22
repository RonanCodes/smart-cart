import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
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

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]')
  if (!(el instanceof HTMLInputElement)) {
    throw new Error('file input not found')
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

  it('always offers the optional phone field + an attach-a-screenshot control', () => {
    useSession.mockReturnValue({ data: null })
    const { container } = render(<FeedbackForm source="bubble" />)
    expect(container.querySelector('#feedback-phone')).toBeTruthy()
    expect(container.querySelector('input[type="file"]')).toBeTruthy()
    expect(container.textContent).toContain('Attach a screenshot')
    expect(container.textContent).toContain('Open to a chat?')
  })

  // The user ATTACHES a (native) screenshot; the thumbnail must be tappable to
  // open a full-screen preview so they can inspect what they're sending (#404).
  it('shows a tappable thumbnail + lightbox after attaching an image', async () => {
    useSession.mockReturnValue({ data: null })
    const { container } = render(<FeedbackForm source="bubble" />)

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', {
      type: 'image/png',
    })
    fireEvent.change(fileInput(container), { target: { files: [file] } })

    const thumb = await waitFor(() => {
      const el = document.body.querySelector(
        'button[aria-label="View screenshot full screen"]',
      )
      if (!el) throw new Error('thumbnail not ready')
      return el as HTMLButtonElement
    })

    fireEvent.click(thumb)
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute('aria-label')).toBe('Screenshot preview')
  })
})
