import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * ProfileSkeleton — the /profile route's pendingComponent (#229). Holds the real
 * page's frame (shell, large title, the email subtitle line, and the iOS grouped
 * settings lists) while the loader resolves the admin flag + preferred store, so
 * navigating to the tab shows its shape immediately. The loader still runs on the
 * server and hydrates first paint (SSR untouched); this only shows on client
 * navigations and slow loads. Three grouped lists mirror the live layout: the
 * settings group (store / notifications / help), then the redo + sign-out group.
 * The admin group is omitted here because it only renders for true admins.
 */
export function ProfileSkeleton() {
  return (
    <AppShell>
      <ScreenHeader title="Profile" />
      <div
        className="space-y-6 px-4 pt-2"
        aria-busy="true"
        aria-label="Loading your profile"
      >
        <SettingsGroup rows={3} />
        <SettingsGroup rows={2} />
      </div>
    </AppShell>
  )
}

/**
 * SettingsGroup — a grouped-list placeholder shaped like the profile's {@link
 * List} of {@link ListRow}s: a leading round glyph, a title line, a trailing
 * chevron, divided rows inside an iOS card.
 */
function SettingsGroup({ rows }: { rows: number }) {
  return (
    <div className="bg-card divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <Skeleton className="h-4 max-w-[8rem] flex-1" />
          <Skeleton className="h-4 w-4 shrink-0" />
        </div>
      ))}
    </div>
  )
}
