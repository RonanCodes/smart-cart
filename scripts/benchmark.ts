/**
 * Benchmark the swipe recommenders. For each synthetic user we simulate the
 * onboarding swipe loop (the recommender picks the next deck, the user swipes per
 * the hidden ground-truth) and measure how well the recommender's top-20 matches
 * the user's true top-20, as a function of how many swipes it took. The winner is
 * the one that reaches high recall in the fewest swipes.
 *
 *   pnpm tsx scripts/benchmark.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeLite, Swipe, UserProfile } from '../src/lib/recsys/types'
import { makeRecommenders } from '../src/lib/recsys/strategies'
import { simulateSwipe, trueTopN } from '../src/lib/recsys/ground-truth'

const DECK = 5
const CHECKPOINTS = [5, 10, 15, 20, 25, 30]
const MAX = CHECKPOINTS[CHECKPOINTS.length - 1]!
const TOP_N = 20
const TARGET_RECALL = 0.6

function load<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', name), 'utf8'),
  ) as T
}

function recall(got: Array<RecipeLite>, truth: Array<string>): number {
  if (truth.length === 0) return 1
  const t = new Set(truth)
  const hit = got.filter((r) => t.has(r.id)).length
  return hit / Math.min(truth.length, TOP_N)
}

function main() {
  const recipes = load<Array<RecipeLite>>('recipes.json')
  const users = load<Array<UserProfile>>('synthetic-users.json')
  const names = makeRecommenders(recipes).map((r) => r.name)

  // Aggregate: recall at each checkpoint, and swipes-to-target per recommender.
  const recallSum = new Map<string, Map<number, number>>()
  const swipesToTarget = new Map<string, Array<number>>()
  for (const n of names) {
    recallSum.set(n, new Map(CHECKPOINTS.map((c) => [c, 0])))
    swipesToTarget.set(n, [])
  }

  for (const user of users) {
    const truth = trueTopN(user, recipes, TOP_N)
    if (truth.length === 0) continue
    for (const rec of makeRecommenders(recipes)) {
      const swipes: Array<Swipe> = []
      let reached = MAX + 1
      while (swipes.length < MAX) {
        const deck = rec.nextDeck(swipes, Math.min(DECK, MAX - swipes.length))
        if (deck.length === 0) break
        for (const r of deck)
          swipes.push({ recipeId: r.id, like: simulateSwipe(user, r) })
        const count = swipes.length
        if (CHECKPOINTS.includes(count)) {
          const r = recall(rec.recommend(swipes, TOP_N), truth)
          recallSum
            .get(rec.name)!
            .set(count, recallSum.get(rec.name)!.get(count)! + r)
          if (r >= TARGET_RECALL && reached > MAX) reached = count
        }
      }
      swipesToTarget.get(rec.name)!.push(reached)
    }
  }

  const used = users.filter(
    (u) => trueTopN(u, recipes, TOP_N).length > 0,
  ).length
  const median = (a: Array<number>) => {
    const s = [...a].sort((x, y) => x - y)
    return s[Math.floor(s.length / 2)] ?? 0
  }

  // Markdown report.
  let md = `# Swipe recommender benchmark\n\n`
  md += `Catalogue: ${recipes.length} recipes. Synthetic users: ${used}. Deck ${DECK}/round, recall@${TOP_N} vs each user's true top ${TOP_N}.\n\n`
  md += `## Recall@${TOP_N} by swipe count\n\n`
  md += `| strategy | ${CHECKPOINTS.map((c) => `${c} swipes`).join(' | ')} | median swipes to ${TARGET_RECALL * 100}% |\n`
  md += `| --- | ${CHECKPOINTS.map(() => '---').join(' | ')} | --- |\n`
  const summary: Record<string, unknown> = {}
  for (const n of names) {
    const cells = CHECKPOINTS.map(
      (c) => `${((recallSum.get(n)!.get(c)! / used) * 100).toFixed(0)}%`,
    )
    const reached = swipesToTarget.get(n)!.filter((x) => x <= MAX)
    const pctReached = ((reached.length / used) * 100).toFixed(0)
    const med = reached.length ? median(reached) : MAX + 1
    md += `| **${n}** | ${cells.join(' | ')} | ${reached.length ? med : 'n/a'} (${pctReached}% reach) |\n`
    summary[n] = {
      recallByCheckpoint: Object.fromEntries(
        CHECKPOINTS.map((c) => [c, recallSum.get(n)!.get(c)! / used]),
      ),
      medianSwipesToTarget: reached.length ? med : null,
      pctReachedTarget: reached.length / used,
    }
  }
  md += `\nHigher recall sooner is better. "median swipes to ${TARGET_RECALL * 100}%" is the headline: the fewest swipes to a good match.\n`

  mkdirSync(join(process.cwd(), 'docs', 'benchmarks'), { recursive: true })
  writeFileSync(join(process.cwd(), 'docs', 'benchmarks', 'results.md'), md)
  writeFileSync(
    join(process.cwd(), 'docs', 'benchmarks', 'results.json'),
    JSON.stringify(
      { generatedFrom: { recipes: recipes.length, users: used }, summary },
      null,
      2,
    ),
  )
  console.log(md)
}

main()
