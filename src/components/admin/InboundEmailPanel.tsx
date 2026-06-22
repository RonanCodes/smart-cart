import { MailOpen } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import type { InboundEmailResult } from '#/lib/inbound-email'

/**
 * The inbound-email panel (#459) — emails received at hello@souso.app, read live
 * from the Resend received-emails API rather than a bespoke DB table. Sits on the
 * admin feedback tab beside the Sentry + in-app feedback.
 *
 * Styled to the Souso design system: a clear section header, each email in its
 * own iOS-radius card with the sender, subject, and time. When live data is
 * unavailable (key unset, inbound not enabled for the domain, or a fetch blip)
 * the server-supplied `note` is shown calmly — the inbound mail still reaches the
 * admins via the forward (see #457).
 */
export function InboundEmailPanel({
  data,
}: {
  // SOUSO-19: the loader's source really can arrive undefined (RPC torn down /
  // failed) even though the server fn's static return type says it can't. Widen
  // the prop so the runtime guard below is honest, not stripped as "always
  // truthy" by the no-unnecessary-condition lint (the push-client.ts precedent).
  data: InboundEmailResult | null | undefined
}) {
  const items = data?.items ?? []
  const note = data?.note ?? null
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-bold tracking-[-0.01em]">Inbound emails</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Emails received at hello@souso.app, read live from Resend. Newest
          first.
        </p>
      </header>

      {note && (
        <Card
          ios
          className="text-muted-foreground flex items-start gap-3 px-4 py-3.5 text-sm"
        >
          <MailOpen
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
            <MailOpen
              className="text-muted-foreground/60 h-8 w-8"
              aria-hidden
            />
            <p>No inbound emails yet.</p>
          </Card>
        )
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="bg-card rounded-[var(--radius-ios)] px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">Inbound</Badge>
                {item.from && (
                  <a
                    href={`mailto:${item.from}`}
                    className="text-primary text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    {item.from}
                  </a>
                )}
                {item.createdAtMs != null && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {new Date(item.createdAtMs).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed">
                {item.subject ?? (
                  <span className="text-muted-foreground italic">
                    (no subject)
                  </span>
                )}
              </p>
              {item.to.length > 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  to {item.to.join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
