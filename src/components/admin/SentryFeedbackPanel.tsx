import { MessageSquareWarning, ExternalLink } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import { sentryEventUrl } from '#/lib/sentry-admin'
import type { SentryFeedbackResult } from '#/lib/sentry-admin'

const SENTRY_HOST = 'de.sentry.io'
const SENTRY_ORG = 'ronan-connolly'
const SENTRY_PROJECT = 'souso'

/**
 * The Sentry user-feedback panel (#458) — feedback the team submitted through
 * Sentry, read live from the Sentry API so the business team sees it without a
 * Sentry login. Sits alongside the in-app feedback inbox on /admin/feedback.
 *
 * Styled to the Souso design system: a clear section header, each entry in its
 * own iOS-radius card with a "Sentry" badge, the sender's contact, and a quiet
 * deep-link out to the event in Sentry. When live data is unavailable the
 * server-supplied `note` is shown in a calm card rather than an error.
 */
export function SentryFeedbackPanel({
  data,
}: {
  // SOUSO-19: the loader's source really can arrive undefined (RPC torn down /
  // failed) even though the server fn's static return type says it can't. Widen
  // the prop so the runtime guard below is honest, not stripped as "always
  // truthy" by the no-unnecessary-condition lint (the push-client.ts precedent).
  data: SentryFeedbackResult | null | undefined
}) {
  const items = data?.items ?? []
  const note = data?.note ?? null
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold tracking-[-0.01em]">
          Sentry feedback
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          User feedback submitted through Sentry, read live from the Sentry API.
          Newest first.
        </p>
      </header>

      {note && (
        <Card
          ios
          className="text-muted-foreground flex items-start gap-3 px-4 py-3.5 text-sm"
        >
          <MessageSquareWarning
            className="text-muted-foreground/70 mt-0.5 h-4 w-4 shrink-0"
            aria-hidden
          />
          <p>{note}</p>
        </Card>
      )}

      {items.length === 0 ? (
        !note && (
          <Card
            ios
            className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm"
          >
            <MessageSquareWarning
              className="text-muted-foreground/60 h-8 w-8"
              aria-hidden
            />
            <p>No Sentry feedback yet.</p>
          </Card>
        )
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const eventUrl = sentryEventUrl({
              host: SENTRY_HOST,
              org: SENTRY_ORG,
              project: SENTRY_PROJECT,
              eventID: item.eventID,
            })
            return (
              <li
                key={item.id}
                className="bg-card rounded-[var(--radius-ios)] px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Sentry</Badge>
                  {item.name && (
                    <span className="text-sm font-semibold">{item.name}</span>
                  )}
                  {item.createdAtMs != null && (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {new Date(item.createdAtMs).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {item.comments}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {item.email && (
                    <a
                      href={`mailto:${item.email}`}
                      className="text-primary font-semibold underline-offset-2 hover:underline"
                    >
                      {item.email}
                    </a>
                  )}
                  {eventUrl && (
                    <a
                      href={eventUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 underline-offset-2 hover:underline"
                    >
                      View in Sentry
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
