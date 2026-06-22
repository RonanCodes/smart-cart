import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { FeedbackForm, excludeFromScreenshot } from './FeedbackForm'

// html-to-image is dynamically imported by the capture path; stub it so a click
// on "Add screenshot" resolves to a fake data-URL without a real DOM snapshot.
const toPng = vi.fn<() => Promise<string>>(
  async () => 'data:image/png;base64,AAAA',
)
vi.mock('html-to-image', () => ({ toPng: () => toPng() }))

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

  // After capture, the thumbnail must be TAPPABLE to open a full-screen preview
  // so the user can inspect exactly what they're about to send (#feedback UX).
  it('opens a full-screen lightbox when the captured thumbnail is tapped', async () => {
    useSession.mockReturnValue({ data: null })
    render(<FeedbackForm source="bubble" />)

    const addBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent.includes('Add screenshot'),
    )
    expect(addBtn).toBeTruthy()
    fireEvent.click(addBtn!)

    // Once the fake toPng resolves, a tappable thumbnail appears.
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

describe('excludeFromScreenshot', () => {
  it('drops a node marked data-screenshot-exclude (the capturing banner)', () => {
    const el = document.createElement('div')
    el.setAttribute('data-screenshot-exclude', 'true')
    expect(excludeFromScreenshot(el)).toBe(false)
  })

  it('keeps every other node in the shot', () => {
    const el = document.createElement('div')
    expect(excludeFromScreenshot(el)).toBe(true)
  })

  it('never throws on a node without hasAttribute (e.g. a text node)', () => {
    const textish = { nodeType: 3 } as unknown as HTMLElement
    expect(() => excludeFromScreenshot(textish)).not.toThrow()
    expect(excludeFromScreenshot(textish)).toBe(true)
  })
})
