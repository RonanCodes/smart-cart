import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  CalendarDays,
  MessageCircle,
  Search,
  ShoppingBasket,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Sheet } from '#/components/ui/sheet'
import { FeedbackForm } from '#/components/feedback/FeedbackForm'

/**
 * TabBar — the fixed, translucent bottom navigation that gives the app its
 * iOS / Expo feel. Four tabs (Week / Search / Cart / Profile), SF-style lucide
 * icons over short labels, an active tint in the brand green, a hairline top
 * border, and a backdrop blur over the `--material` wash. It sits above the home
 * indicator by padding its own bottom with `--safe-bottom`.
 *
 * Between Search and Cart sits a raised, notched mustard FAB — the SINGLE
 * always-available feedback trigger (the redesigned feedback flow, replacing the
 * auto-injected Sentry widget). Tapping it opens the shared `FeedbackForm` in a
 * bottom Sheet; on success the sheet closes. The four tabs stay evenly spaced
 * around the FAB.
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

// Split so the FAB drops into the middle: [Week, Search] [FAB] [Cart, Profile].
const LEFT_TABS: Array<TabDef> = [
  { to: '/week', label: 'Week', icon: CalendarDays },
  { to: '/discover', label: 'Search', icon: Search },
]
const RIGHT_TABS: Array<TabDef> = [
  { to: '/shopping', label: 'Cart', icon: ShoppingBasket },
  { to: '/profile', label: 'Profile', icon: User },
]

function isActive(pathname: string, tab: TabDef): boolean {
  const candidates = [tab.to, ...(tab.match ?? [])]
  return candidates.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function TabItem({ tab, pathname }: { tab: TabDef; pathname: string }) {
  const active = isActive(pathname, tab)
  const Icon = tab.icon
  return (
    <li className="flex-1">
      <Link
        to={tab.to}
        // The tab bar is always on screen, so `viewport` warms all four tab
        // routes in the background once after paint (#302). Combined with
        // defaultPreloadStaleTime:30_000, the warm match is reused on tap, so
        // switching tabs is instant instead of blocking on a fresh auth +
        // loader round-trip. The 30s cache stops it re-fetching.
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
}

export function TabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
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
          className="relative mx-auto flex max-w-md items-stretch"
          style={{ height: 'var(--tab-bar-height)' }}
        >
          {LEFT_TABS.map((tab) => (
            <TabItem key={tab.to} tab={tab} pathname={pathname} />
          ))}

          {/* The notch the FAB sits in: a fixed-width slot that keeps the four
              tabs evenly spaced around the centre button. */}
          <li className="flex w-16 shrink-0 items-center justify-center">
            <button
              type="button"
              aria-label="Send feedback"
              onClick={() => setFeedbackOpen(true)}
              className={cn(
                // Raised above the bar so it reads as a distinct affordance.
                'absolute -top-4 left-1/2 -translate-x-1/2',
                'flex h-12 w-12 items-center justify-center rounded-full',
                // On-brand mustard accent + a forest-green glyph.
                'bg-[#e8a33d] text-[#16341f] shadow-lg',
                'ring-[3px] ring-[var(--material)]',
                'transition hover:brightness-105 active:scale-95',
              )}
            >
              <MessageCircle
                className="h-6 w-6"
                strokeWidth={2.2}
                aria-hidden
              />
            </button>
          </li>

          {RIGHT_TABS.map((tab) => (
            <TabItem key={tab.to} tab={tab} pathname={pathname} />
          ))}
        </ul>
      </nav>

      <Sheet
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        title="Send feedback"
      >
        <FeedbackForm source="bubble" onDone={() => setFeedbackOpen(false)} />
      </Sheet>
    </>
  )
}
