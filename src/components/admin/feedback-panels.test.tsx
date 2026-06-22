import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SentryFeedbackPanel } from './SentryFeedbackPanel'
import { InboundEmailPanel } from './InboundEmailPanel'
import { AppFeedbackInbox } from './AppFeedbackInbox'
import type { SentryFeedbackResult } from '#/lib/sentry-admin'
import type { InboundEmailResult } from '#/lib/inbound-email'
import type { AppFeedbackItem } from '#/lib/app-feedback-server'

/**
 * Regression for SOUSO-19 — the admin feedback panels (#473) crashed with
 * "Cannot read properties of undefined (reading 'length')" when a source server
 * fn resolved to undefined (RPC torn down, token unset path, or a fetch blip the
 * loader couldn't shape). The Promise.all loader hands each panel its slice; if a
 * slice arrives undefined, destructuring `{ items, note }` and reading
 * `items.length` threw and took the whole tab down.
 *
 * Each panel MUST render (empty state, no throw) when handed an undefined source
 * or an undefined `items` field. We deliberately pass `undefined` past the type
 * with a cast: the runtime really can deliver it even though the type says it
 * can't.
 */

describe('admin feedback panels — undefined-source safety (SOUSO-19)', () => {
  it('SentryFeedbackPanel renders the empty state when data is undefined', () => {
    expect(() =>
      render(
        <SentryFeedbackPanel
          data={undefined as unknown as SentryFeedbackResult}
        />,
      ),
    ).not.toThrow()
    expect(screen.getByText('Sentry feedback')).toBeTruthy()
  })

  it('SentryFeedbackPanel renders when items is undefined', () => {
    expect(() =>
      render(
        <SentryFeedbackPanel
          data={
            { items: undefined, note: null } as unknown as SentryFeedbackResult
          }
        />,
      ),
    ).not.toThrow()
    expect(screen.getByText('No Sentry feedback yet.')).toBeTruthy()
  })

  it('InboundEmailPanel renders the empty state when data is undefined', () => {
    expect(() =>
      render(
        <InboundEmailPanel data={undefined as unknown as InboundEmailResult} />,
      ),
    ).not.toThrow()
    expect(screen.getByText('Inbound emails')).toBeTruthy()
  })

  it('InboundEmailPanel renders when items is undefined', () => {
    expect(() =>
      render(
        <InboundEmailPanel
          data={
            { items: undefined, note: null } as unknown as InboundEmailResult
          }
        />,
      ),
    ).not.toThrow()
    expect(screen.getByText('No inbound emails yet.')).toBeTruthy()
  })

  it('AppFeedbackInbox renders the empty state when items is undefined', () => {
    expect(() =>
      render(
        <AppFeedbackInbox
          items={undefined as unknown as Array<AppFeedbackItem>}
        />,
      ),
    ).not.toThrow()
    expect(screen.getByText('Feedback inbox')).toBeTruthy()
  })
})
