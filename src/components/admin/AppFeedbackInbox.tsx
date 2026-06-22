import { Badge } from '#/components/ui/badge'
import type { AppFeedbackItem } from '#/lib/app-feedback-server'

/**
 * The general in-app feedback inbox (#404) — the free-text messages users send
 * from the floating bubble or from Settings, newest first. Sits at the top of
 * the admin feedback tab, above the recsys real-feedback fold-in panel, so the
 * admin reads both kinds of "feedback" in one place.
 */
export function AppFeedbackInbox({ items }: { items: Array<AppFeedbackItem> }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-bold">Feedback inbox</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        Free-text feedback sent from the app (the bubble + Settings). Newest
        first.
      </p>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          No feedback yet. The bubble + Settings entry feed this inbox.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="bg-card rounded-xl border px-4 py-3 shadow-sm"
            >
              <div className="mb-1.5 flex items-center gap-2">
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
              {item.email && (
                <a
                  href={`mailto:${item.email}`}
                  className="text-primary mt-1.5 inline-block text-xs font-semibold underline-offset-2 hover:underline"
                >
                  {item.email}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
