import * as React from 'react'
import { cn } from '#/lib/utils'
import { SafeArea } from '#/components/ui/safe-area'
import { TabBar } from '#/components/ui/tab-bar'

/**
 * AppShell — the iOS-native frame the main app screens live inside. It owns the
 * fixed bottom TabBar and the safe-area handling so individual screens don't
 * repeat that wiring. Onboarding / sign-in are full-screen flows and do NOT use
 * this shell (no tab bar there).
 *
 *   <AppShell>
 *     <ScreenHeader title="Your week" />
 *     ...screen content...
 *   </AppShell>
 *
 * Content scrolls under a translucent header and clears the tab bar via the
 * `--tab-bar-space` bottom padding.
 *
 * Desktop framing: the app is mobile-first, so on a phone (<= 480px) this is a
 * plain full-width column. From 481px up the `app-backdrop` + `app-frame`
 * classes (defined in styles.css behind a min-width media query) centre the
 * screen in a phone-width column over a warm backdrop, and the TabBar's
 * `app-tabbar` class pins it to that same column. Mobile is byte-for-byte
 * unchanged because every desktop rule is gated behind the media query.
 */
export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
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
      <TabBar />
    </SafeArea>
  )
}

/**
 * ScreenHeader — a large iOS-style title block. The big title sits left-aligned
 * (UINavigationBar large-title style); an optional trailing action sits on the
 * right (sign out, back, etc.).
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('px-5 pt-4 pb-2', className)}>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">
          {title}
        </h1>
        {action && <div className="shrink-0 pt-1">{action}</div>}
      </div>
      {subtitle && (
        <p className="text-muted-foreground mt-1 text-[0.95rem]">{subtitle}</p>
      )}
    </header>
  )
}

/**
 * EmptyState — a centred icon + title + hint, used by the stub tabs and any
 * first-run / no-data screen. Designed with the same care as the happy path
 * (frontend-design house rule).
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  hint?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-8 py-20 text-center',
        className,
      )}
    >
      {icon && (
        <div className="bg-secondary text-muted-foreground mb-4 flex h-16 w-16 items-center justify-center rounded-full [&>svg]:h-8 [&>svg]:w-8">
          {icon}
        </div>
      )}
      <p className="text-lg font-semibold">{title}</p>
      {hint && (
        <p className="text-muted-foreground mt-1 max-w-xs text-sm">{hint}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
