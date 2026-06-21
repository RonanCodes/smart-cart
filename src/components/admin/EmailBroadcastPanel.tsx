import { useState } from 'react'
import { Mail } from 'lucide-react'
import { sendLaunchEmailToAllUsers } from '#/lib/launch-server'
import type { LaunchEmailPreview } from '#/lib/launch-server'
import { Button } from '#/components/ui/button'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'

/**
 * Admin "Email all users" panel. One button broadcasts the "Souso is live"
 * launch email to every registered user, with the exact subject + body shown in
 * a preview card beside the button so the admin reviews what goes out first. This
 * exists so the launch email can be (re)sent even if it was never sent at
 * go-live, independent of the launch-state toggle on the Launch tab.
 *
 * Safety: nothing sends on load. Tapping the button opens a confirm dialog naming
 * the recipient count; only confirming Send calls the server fn (admin-gated,
 * best-effort per recipient). The result (sent / failed) is reported after.
 */
export function EmailBroadcastPanel({
  preview,
}: {
  preview: LaunchEmailPreview
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const count = preview.recipientCount

  async function send() {
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await sendLaunchEmailToAllUsers()
      setMsg(
        res.failed > 0
          ? `Sent to ${res.sent} of ${res.total}. ${res.failed} failed.`
          : `Sent the launch email to all ${res.sent} ${res.sent === 1 ? 'user' : 'users'}.`,
      )
    } catch {
      setMsg('Could not send the launch email, try again.')
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Email all users</h2>
        <p className="text-muted-foreground text-sm">
          Send the &ldquo;Souso is live&rdquo; launch email to every registered
          user. Use this if the launch email never went out at go-live. Review
          the exact email below before sending.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
        {/* The action */}
        <div className="space-y-2">
          <Button
            size="lg"
            disabled={busy || count === 0}
            onClick={() => setConfirmOpen(true)}
          >
            <Mail className="h-4 w-4" aria-hidden />
            {busy ? 'Sending…' : "Email all users: we're live"}
          </Button>
          <p className="text-muted-foreground text-xs">
            {count === 0
              ? 'No registered users to send to yet.'
              : `Sends to ${count} ${count === 1 ? 'user' : 'users'}.`}
          </p>
          {msg && (
            <p
              role="status"
              className="text-muted-foreground bg-secondary rounded-lg px-3 py-2 text-sm"
            >
              {msg}
            </p>
          )}
        </div>

        {/* The preview — exactly what every recipient receives. */}
        <div className="border-border bg-card min-w-0 space-y-3 rounded-xl border p-5">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Email preview
          </p>
          <div>
            <p className="text-muted-foreground text-xs">Subject</p>
            <p className="font-semibold break-words">{preview.subject}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Body</p>
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {preview.body}
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            The &ldquo;Open Souso&rdquo; button links to{' '}
            <span className="break-all">{preview.signInUrl}</span>
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send the launch email to all ${count} ${count === 1 ? 'user' : 'users'}?`}
        description="This cannot be undone. Every registered user gets the 'Souso is live' email."
        confirmLabel="Send"
        busy={busy}
        onConfirm={() => void send()}
      />
    </div>
  )
}
