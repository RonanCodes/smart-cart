import { Link } from '@tanstack/react-router'
import { LayoutGrid } from 'lucide-react'

/**
 * A fixed "Design preview" indicator shown on every /design/* prototype screen,
 * so it's obvious you're in TJ's clickable prototype (dummy data, no login) and
 * not the real app. Tapping it jumps back to the /designs index, which is the
 * way to hop into any other design. Throwaway alongside the design.* routes.
 */
export function DesignBadge() {
  return (
    <Link
      to="/designs"
      aria-label="Design preview — back to the index"
      className="bg-primary text-primary-foreground fixed top-3 left-1/2 z-[60] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem] font-bold tracking-wide shadow-md"
      style={{ top: 'calc(var(--safe-top, 0px) + 0.5rem)' }}
    >
      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
      DESIGN PREVIEW
    </Link>
  )
}
