import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { CalendarDays, Search, ShoppingBasket, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { SafeArea } from '#/components/ui/safe-area'

/**
 * DESIGN PREVIEW shell (throwaway). A clone of AppShell whose bottom tab bar
 * links to the /design/* prototype routes instead of the real app, so the whole
 * Souso design can be clicked through end-to-end without touching the real
 * (loader-backed) screens. Delete with the design.* routes before shipping.
 */

interface TabDef {
  to: string
  label: string
  icon: LucideIcon
}

const TABS: Array<TabDef> = [
  { to: '/design/week', label: 'Week', icon: CalendarDays },
  { to: '/design/discover', label: 'Search', icon: Search },
  { to: '/design/shopping', label: 'Cart', icon: ShoppingBasket },
  { to: '/design/settings', label: 'Profile', icon: User },
]

export function DesignShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <SafeArea
      edges={['top', 'left', 'right']}
      className={cn(
        'app-backdrop bg-background ios-scroll flex flex-col',
        className,
      )}
    >
      <div className="app-frame flex flex-1 flex-col">
        <main
          className="mx-auto w-full max-w-md flex-1"
          style={{ paddingBottom: 'calc(var(--tab-bar-space) + 1rem)' }}
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="app-tabbar bg-material border-hairline fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl backdrop-saturate-150"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul
          className="mx-auto flex max-w-md items-stretch"
          style={{ height: 'var(--tab-bar-height)' }}
        >
          {TABS.map((tab) => {
            const active =
              pathname === tab.to || pathname.startsWith(`${tab.to}/`)
            const Icon = tab.icon
            return (
              <li key={tab.to} className="flex-1">
                <Link
                  to={tab.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-full flex-col items-center justify-center gap-0.5 text-[0.625rem] font-medium tracking-tight transition active:scale-95',
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
    </SafeArea>
  )
}
