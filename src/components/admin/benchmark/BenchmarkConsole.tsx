import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { runBenchmarkFast } from '#/lib/admin-server'
import type { BenchmarkMeta, RunBenchmarkResult } from '#/lib/admin-server'
import type { AdaptiveWeights } from '#/lib/recsys/types'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { WeightControls } from './WeightControls'
import { ResultsTable } from './ResultsTable'

/**
 * The Benchmark tab body. Lets an admin pick an algorithm (dropdown from the live
 * registry, so a future `bayesian` strategy shows up automatically), tweak the
 * Adaptive weights, run a FAST sub-sampled benchmark over the frozen fixture, and
 * compare the result's recall against the committed baseline head to head.
 *
 * `meta` is loaded by the route loader so the controls render with the real keys +
 * default weights immediately. The run itself is a POST server fn (with a spinner).
 */
export function BenchmarkConsole({ meta }: { meta: BenchmarkMeta }) {
  const [algorithm, setAlgorithm] = useState(meta.defaultAlgorithm)
  const [weights, setWeights] = useState<AdaptiveWeights>(meta.defaultWeights)
  const [userLimit, setUserLimit] = useState(40)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunBenchmarkResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAdaptive = algorithm === 'adaptive'

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const r = await runBenchmarkFast({
        data: {
          algorithm,
          weights: isAdaptive ? weights : undefined,
          userLimit,
        },
      })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Benchmark run failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      {/* Controls */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run a benchmark</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Algorithm</span>
              <select
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {meta.algorithms.map((k) => (
                  <option key={k} value={k}>
                    {k}
                    {k === meta.defaultAlgorithm ? ' (live)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                Sample size ({userLimit} users)
              </span>
              <Input
                type="number"
                min={10}
                max={80}
                value={userLimit}
                onChange={(e) =>
                  setUserLimit(
                    Math.min(80, Math.max(10, Number(e.target.value) || 40)),
                  )
                }
              />
              <span className="text-muted-foreground block text-xs">
                Capped 10-80 so a run stays a couple of seconds, not a full
                300-user pass.
              </span>
            </label>

            {isAdaptive ? (
              <WeightControls
                weights={weights}
                defaults={meta.defaultWeights}
                onChange={setWeights}
              />
            ) : (
              <p className="text-muted-foreground text-xs">
                {algorithm} has no tunable weights. Switch to{' '}
                <span className="font-medium">adaptive</span> to tune the
                ranker.
              </p>
            )}

            <Button onClick={run} disabled={running} className="w-full">
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run benchmark
                </>
              )}
            </Button>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      <div className="space-y-4">
        {running && !result && (
          <Card>
            <CardContent className="flex items-center gap-3 py-10">
              <Loader2 className="text-primary h-5 w-5 animate-spin" />
              <span className="text-muted-foreground text-sm">
                Simulating swipes over the frozen fixture…
              </span>
            </CardContent>
          </Card>
        )}

        {result ? (
          <ResultsTable
            result={result}
            baseline={meta.baseline}
            running={running}
          />
        ) : (
          !running && (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-sm">
                Pick an algorithm and run a benchmark to see recall vs the
                committed baseline.
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  )
}
