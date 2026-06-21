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

  // #383: NotFoundError "the object can not be found here" — the exit-animation
  // unmount tore down a sheet that had been reopened before the animation ended,
  // so React tried to remove a node the browser had already moved. The deferred,
  // re-checked unmount must keep the content mounted when `open` is true again by
  // the time the animation-end handler runs.
  it('stays mounted when reopened before the exit animation finishes (#383)', async () => {
    const { rerender } = render(
      <Sheet open onOpenChange={() => {}} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    // Begin closing.
    rerender(
      <Sheet open={false} onOpenChange={() => {}} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    // Reopen before the exit animation completes.
    rerender(
      <Sheet open onOpenChange={() => {}} title="Swap dinner">
        <p>body</p>
      </Sheet>,
    )
    // The (stale) close animation now ends on the panel.
    const dialog = screen.getByRole('dialog', { name: 'Swap dinner' })
    fireEvent.animationEnd(dialog)
    // It must see the latest open===true (via the ref, not the stale closure)
    // and skip the unmount, so the reopened sheet's content stays in the tree.
    expect(screen.queryByText('body')).not.toBeNull()
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
