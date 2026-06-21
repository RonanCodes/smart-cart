import { Link, useRouterState } from '@tanstack/react-router'
import { CalendarDays, Search, ShoppingBasket, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'

/**
 * TabBar — the fixed, translucent bottom navigation that gives the app its
 * iOS / Expo feel. Four tabs (Discover / Week / Shopping / Profile), SF-style
 * lucide icons over short labels, an active tint in the brand green, a hairline
 * top border, and a backdrop blur over the `--material` wash. It sits above the
 * home indicator by padding its own bottom with `--safe-bottom`.
 *
 * Active state is derived from the current pathname so a tab lights up no matter
 * how the user got there (link, redirect, deep link). The bar only renders on
 * the main app area (it is mounted by AppShell), never on full-screen
 * onboarding / sign-in.
 */
interface TabDef {
  to: string
  label: string
  icon: LucideIcon
  /** Extra path prefixes that should also light this tab (e.g. /week deep links). */
  match?: Array<string>
}

const TABS: Array<TabDef> = [
  { to: '/week', label: 'Week', icon: CalendarDays },
  { to: '/discover', label: 'Search', icon: Search },
  { to: '/shopping', label: 'Cart', icon: ShoppingBasket },
  { to: '/profile', label: 'Profile', icon: User },
]

function isActive(pathname: string, tab: TabDef): boolean {
  const candidates = [tab.to, ...(tab.match ?? [])]
  return candidates.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function TabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'app-tabbar fixed inset-x-0 bottom-0 z-40',
        'border-hairline border-t',
        'bg-material backdrop-blur-xl backdrop-saturate-150',
      )}
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul
        className="mx-auto flex max-w-md items-stretch"
        style={{ height: 'var(--tab-bar-height)' }}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab)
          const Icon = tab.icon
          return (
            <li key={tab.to} className="flex-1">
              <Link
                to={tab.to}
                // The tab bar is always on screen, so `viewport` warms all four
                // tab routes in the background once after paint (#302). Combined
                // with defaultPreloadStaleTime:30_000, the warm match is reused on
                // tap, so switching tabs is instant instead of blocking on a fresh
                // auth + loader round-trip. The 30s cache stops it re-fetching.
                preload="viewport"
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-0.5',
                  'text-[0.625rem] font-medium tracking-tight transition',
                  'active:scale-95',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon
                  className="h-6 w-6"
                  strokeWidth={active ? 2.4 : 1.9}
                  aria-hidden
                />
                <span>{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
