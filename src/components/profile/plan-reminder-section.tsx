import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2 } from 'lucide-react'
import { getMyNotifyPrefs, setMyNotifyPrefs } from '#/lib/notify-prefs-server'
import { DOW_LABELS, DEFAULT_NOTIFY_PREFS } from '#/lib/notify-prefs'
import type { NotifyPrefs } from '#/lib/notify-prefs'
import { List } from '#/components/ui/list'

/**
 * Profile "Weekly planning reminder" section (Part B). A toggle + a day-of-week
 * picker + a time input, in the app's iOS card styling. Saves the household's
 * preference via the server fn; the scheduled handler (Part C) reads it to fire a
 * "Time to plan next week" push at the chosen local (Amsterdam) day + time.
 *
 * Imports ONLY the createServerFn refs (handler bodies stripped at build) + pure
 * helpers/types, so no server-only module leaks into the client bundle.
 */
export function PlanReminderSection() {
  // Seed from a query so the saved values survive a tab switch with no refetch.
  const { data } = useQuery({
    queryKey: ['notify-prefs'],
    queryFn: () => getMyNotifyPrefs(),
    initialData: DEFAULT_NOTIFY_PREFS,
  })

  const [prefs, setPrefs] = useState<NotifyPrefs>(data)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Persist a change immediately (optimistic): reflect it locally, then write. On
  // failure, roll back to the last-saved value the query holds.
  async function save(next: NotifyPrefs) {
    setPrefs(next)
    setBusy(true)
    setMessage(null)
    try {
      await setMyNotifyPrefs({ data: next })
    } catch {
      setPrefs(data)
      setMessage('Could not save, try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Weekly planning reminder</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          A nudge to plan next week, on the day and time you choose.
        </p>
      </div>

      <List>
        <div className="flex items-center gap-3 px-4 py-3">
          <CalendarClock
            className="text-muted-foreground h-5 w-5"
            aria-hidden
          />
          <span className="flex-1 text-base font-medium">Remind me</span>
          {busy && (
            <Loader2
              className="text-muted-foreground h-4 w-4 animate-spin"
              aria-label="Saving"
            />
          )}
          <button
            type="button"
            role="switch"
            aria-checked={prefs.enabled}
            aria-label="Weekly planning reminder"
            disabled={busy}
            onClick={() => void save({ ...prefs, enabled: !prefs.enabled })}
            className={
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ' +
              (prefs.enabled ? 'bg-primary' : 'bg-secondary')
            }
            data-testid="plan-reminder-toggle"
          >
            <span
              className={
                'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ' +
                (prefs.enabled ? 'translate-x-5' : 'translate-x-0.5')
              }
            />
          </button>
        </div>

        {prefs.enabled && (
          <>
            <label className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-base">Day</span>
              <select
                value={prefs.dow}
                disabled={busy}
                onChange={(e) =>
                  void save({ ...prefs, dow: Number(e.target.value) })
                }
                className="bg-secondary text-foreground rounded-lg px-3 py-2 text-sm"
                data-testid="plan-reminder-dow"
              >
                {DOW_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-base">Time</span>
              <input
                type="time"
                value={prefs.time}
                disabled={busy}
                onChange={(e) => void save({ ...prefs, time: e.target.value })}
                className="bg-secondary text-foreground rounded-lg px-3 py-2 text-sm"
                data-testid="plan-reminder-time"
              />
            </label>
          </>
        )}
      </List>

      {message && (
        <p role="status" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
