import type { WaitlistView } from '#/lib/admin-server'

/**
 * The marketing-landing waitlist: a total count plus the signups, newest first.
 * Read-only, desktop-first; admin-gated upstream by the /admin route guard.
 */
export function WaitlistPanel({ waitlist }: { waitlist: WaitlistView }) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {waitlist.count} {waitlist.count === 1 ? 'signup' : 'signups'}
        </h2>
        <p className="text-muted-foreground text-sm">
          Emails captured by the marketing landing, newest first.
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-xl border">
        {waitlist.rows.map((r) => (
          <div
            key={r.email}
            className="flex items-center justify-between px-4 py-3"
          >
            <span className="truncate text-sm font-medium">{r.email}</span>
            <span className="text-muted-foreground ml-3 shrink-0 text-xs">
              {fmt(r.createdAt)}
            </span>
          </div>
        ))}
        {waitlist.rows.length === 0 && (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            No signups yet.
          </p>
        )}
      </div>
    </div>
  )
}
