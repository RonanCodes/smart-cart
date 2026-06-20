import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sheet } from './sheet'
import { List, ListRow } from './list'

describe('Sheet', () => {
  it('does not render content when closed', () => {
    render(
      <Sheet open={false} onOpenChange={() => {}} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    expect(screen.queryByText('body')).toBeNull()
  })

  it('renders a dialog with title and content when open', () => {
    render(
      <Sheet open onOpenChange={() => {}} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Swap dinner' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('calls onOpenChange(false) when the backdrop is tapped', () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    // The backdrop is the dimmed sibling of the panel.
    const backdrop = document.querySelector('.sheet-backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Escape', () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <p>body</p>
      </Sheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ListRow', () => {
  it('renders title, subtitle and fires onClick', () => {
    const onClick = vi.fn()
    render(
      <List>
        <ListRow title="Diet" subtitle="No peanuts" chevron onClick={onClick} />
      </List>,
    )
    fireEvent.click(screen.getByText('Diet'))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByText('No peanuts')).toBeTruthy()
  })
})
