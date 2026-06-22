import { Inbox } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import type { AppFeedbackItem } from '#/lib/app-feedback-server'

/**
 * The general in-app feedback inbox (#404) — the free-text messages users send
 * from the tab-bar FAB, the sign-in page, or Settings, newest first. Sits at the top of
 * the admin feedback tab, above the recsys real-feedback fold-in panel, so the
 * admin reads both kinds of "feedback" in one place.
 *
 * Styled to the Souso design system: a clear section header, each message in
 * its own iOS-radius card with a source Badge, contact links, and the path +
 * time as quiet metadata.
 */
export function AppFeedbackInbox({ items }: { items: Array<AppFeedbackItem> }) {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Feedback inbox</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Free-text feedback sent from the app (the tab-bar FAB, the sign-in
          page, and Settings). Newest first.
        </p>
      </header>

      {items.length === 0 ? (
        <Card
          ios
          className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm"
        >
          <Inbox className="text-muted-foreground/60 h-8 w-8" aria-hidden />
          <p>
            No feedback yet. The tab-bar FAB, the sign-in page, and Settings
            feed this inbox.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="bg-card rounded-[var(--radius-ios)] px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.source}</Badge>
                {item.path && (
                  <span className="text-muted-foreground text-xs">
                    {item.path}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto text-xs">
                  {new Date(item.createdAtMs).toLocaleString()}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {item.message}
              </p>
              {(item.email || item.phone) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {item.email && (
                    <a
                      href={`mailto:${item.email}`}
                      className="text-primary font-semibold underline-offset-2 hover:underline"
                    >
                      {item.email}
                    </a>
                  )}
                  {item.phone && (
                    <a
                      href={`tel:${item.phone}`}
                      className="text-primary font-semibold underline-offset-2 hover:underline"
                    >
                      {item.phone}
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
