import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayCardSkeleton } from './DayCardSkeleton'

describe('DayCardSkeleton', () => {
  it('marks the row busy and labels the day so assistive tech announces the wait', () => {
    render(<DayCardSkeleton day="Monday" />)
    const row = screen.getByLabelText('Updating Monday')
    expect(row.getAttribute('aria-busy')).toBe('true')
  })

  it('renders the dashed-divider day-row frame so swapping it for a DayCard does not shift the list', () => {
    const { container } = render(<DayCardSkeleton day="Tuesday" />)
    const row = container.firstElementChild
    expect(row?.className).toContain('border-dashed')
    expect(row?.className).toContain('py-5')
  })
})
