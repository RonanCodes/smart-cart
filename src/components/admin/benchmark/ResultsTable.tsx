import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { BaselineAlgo, RunBenchmarkResult } from '#/lib/admin-server'
import { cn } from '#/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'

interface Baseline {
  metric: string
  checkpoints: Array<number>
  algorithms: Record<string, BaselineAlgo>
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/**
 * Head-to-head accuracy: the just-run algorithm's recall vs the committed baseline,
 * per checkpoint, with a clear better/worse delta. Plus a comparison table of every
 * baselined algorithm so the admin sees where this run lands in the field, and a
 * simple bar per algorithm (no chart library, just divs).
 */
export function ResultsTable({
  result,
  baseline,
  running,
}: {
  result: RunBenchmarkResult
  baseline: Baseline
  running: boolean
}) {
  const baselineForRun = baseline.algorithms[result.key]
  // The checkpoint both the run and the baseline measured, prefer the largest.
  const sharedCheckpoints = result.checkpoints.filter((c) =>
    baseline.checkpoints.includes(c),
  )
  const headlineCp =
    sharedCheckpoints[sharedCheckpoints.length - 1] ?? result.checkpoints[0]!

  const runRecall = result.recallByCheckpoint[headlineCp] ?? 0
  const baseRecall = baselineForRun?.recallByCheckpoint[String(headlineCp)]
  const delta = baseRecall != null ? runRecall - baseRecall : null

  return (
    <div className="space-y-4">
      {/* Headline head-to-head */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>
              {result.name}{' '}
              <span className="text-muted-foreground font-normal">
                vs baseline
              </span>
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {result.usersScored} users · {result.ranMs} ms
              {running && ' · re-running…'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat label={`this run @${headlineCp}`} value={pct(runRecall)} />
            <Stat
              label={`baseline @${headlineCp}`}
              value={baseRecall != null ? pct(baseRecall) : 'n/a'}
              muted
            />
            <DeltaStat delta={delta} />
          </div>
          <p className="text-muted-foreground text-xs">
            {baseline.metric} on the frozen fixture. A sub-sampled run wobbles a
            few points vs the full 300-user baseline; treat the delta as
            directional.
          </p>
        </CardContent>
      </Card>

      {/* Per-checkpoint table for this run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recall by checkpoint</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ios-scroll -mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">swipes</th>
                  <th className="py-2 font-medium">this run</th>
                  <th className="py-2 font-medium">baseline</th>
                  <th className="py-2 font-medium">delta</th>
                </tr>
              </thead>
              <tbody>
                {result.checkpoints.map((cp) => {
                  const run = result.recallByCheckpoint[cp] ?? 0
                  const base = baselineForRun?.recallByCheckpoint[String(cp)]
                  const d = base != null ? run - base : null
                  return (
                    <tr key={cp} className="border-b last:border-0">
                      <td className="py-2">{cp}</td>
                      <td className="py-2 font-medium">{pct(run)}</td>
                      <td className="text-muted-foreground py-2">
                        {base != null ? pct(base) : 'n/a'}
                      </td>
                      <td className="py-2">
                        {d != null ? (
                          <span className={cn(deltaColor(d))}>
                            {d >= 0 ? '+' : ''}
                            {(d * 100).toFixed(1)} pts
                          </span>
                        ) : (
                          <span className="text-muted-foreground">n/a</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Median swipes to 60% recall:{' '}
            <span className="text-foreground font-medium">
              {result.medianSwipesToTarget ?? 'not reached'}
            </span>{' '}
            · {pct(result.pctReachedTarget)} of sampled users reached target.
          </p>
        </CardContent>
      </Card>

      {/* Field comparison: every baselined algorithm at the headline checkpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Field comparison @{headlineCp} swipes (committed baseline)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {fieldRows(baseline, headlineCp, result.key).map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-sm">
                {row.key}
                {row.isCurrent && (
                  <Badge variant="primary" className="ml-1 px-1.5 py-0">
                    run
                  </Badge>
                )}
              </span>
              <div className="bg-secondary h-3 flex-1 overflow-hidden rounded-full">
                <div
                  className={cn(
                    'h-full rounded-full',
                    row.isCurrent ? 'bg-primary' : 'bg-muted-foreground/40',
                  )}
                  style={{ width: `${Math.min(100, row.recall * 400)}%` }}
                />
              </div>
              <span className="text-muted-foreground w-14 shrink-0 text-right text-xs">
                {pct(row.recall)}
              </span>
            </div>
          ))}
          <p className="text-muted-foreground pt-1 text-xs">
            Bars scaled x4 for readability (recall values are small absolute
            fractions). Source: docs/benchmarks/baseline.json.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function fieldRows(baseline: Baseline, checkpoint: number, currentKey: string) {
  return Object.entries(baseline.algorithms)
    .map(([key, algo]) => ({
      key,
      recall: algo.recallByCheckpoint[String(checkpoint)] ?? 0,
      isCurrent: key === currentKey,
    }))
    .sort((a, b) => b.recall - a.recall)
}

function deltaColor(d: number) {
  if (d > 0.005) return 'text-emerald-600'
  if (d < -0.005) return 'text-red-500'
  return 'text-muted-foreground'
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={cn('text-2xl font-bold', muted && 'text-muted-foreground')}
      >
        {value}
      </div>
    </div>
  )
}

function DeltaStat({ delta }: { delta: number | null }) {
  if (delta == null) {
    return <Stat label="delta" value="n/a" muted />
  }
  const better = delta > 0.005
  const worse = delta < -0.005
  const Icon = better ? ArrowUp : worse ? ArrowDown : Minus
  return (
    <div>
      <div className="text-muted-foreground text-xs">vs baseline</div>
      <div
        className={cn(
          'flex items-center gap-1 text-2xl font-bold',
          better && 'text-emerald-600',
          worse && 'text-red-500',
          !better && !worse && 'text-muted-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
        {delta >= 0 ? '+' : ''}
        {(delta * 100).toFixed(1)}
        <span className="text-base font-medium">pts</span>
      </div>
    </div>
  )
}
