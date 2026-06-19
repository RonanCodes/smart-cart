import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeLite, Swipe, UserProfile } from '../src/lib/recsys/types'
import {
  AdaptiveRecommender,
  RandomRecommender,
} from '../src/lib/recsys/strategies'
import { simulateSwipe, trueTopN } from '../src/lib/recsys/ground-truth'

const load = <T>(n: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'seed', n), 'utf8')) as T
const recipes = load<Array<RecipeLite>>('recipes.json')
const users = load<Array<UserProfile>>('synthetic-users.json')

function recall(got: Array<RecipeLite>, truth: Array<string>): number {
  if (!truth.length) return 1
  const t = new Set(truth)
  return got.filter((r) => t.has(r.id)).length / Math.min(truth.length, 20)
}

let rSum = 0
let aSum = 0
let aOnRandomSwipes = 0
const N = 50
for (let u = 0; u < N; u++) {
  const user = users[u]!
  const truth = trueTopN(user, recipes, 20)
  if (!truth.length) continue
  // Random's own run
  const rnd = new RandomRecommender(recipes)
  const rs: Array<Swipe> = []
  while (rs.length < 30)
    for (const r of rnd.nextDeck(rs, 5))
      rs.push({ recipeId: r.id, like: simulateSwipe(user, r) })
  rSum += recall(rnd.recommend(rs, 20), truth)
  // Adaptive on its OWN swipes
  const adp = new AdaptiveRecommender(recipes)
  const as: Array<Swipe> = []
  while (as.length < 30)
    for (const r of adp.nextDeck(as, 5))
      as.push({ recipeId: r.id, like: simulateSwipe(user, r) })
  aSum += recall(adp.recommend(as, 20), truth)
  // Adaptive RANKER on RANDOM's swipes (isolate ranker vs deck)
  aOnRandomSwipes += recall(
    new AdaptiveRecommender(recipes).recommend(rs, 20),
    truth,
  )
}
console.log('random recall@30:', (rSum / N).toFixed(3))
console.log('adaptive recall@30 (own swipes):', (aSum / N).toFixed(3))
console.log(
  'adaptive ranker on RANDOM swipes:',
  (aOnRandomSwipes / N).toFixed(3),
)

// One concrete user
const user = users[3]!
console.log('\nuser u003', JSON.stringify(user))
const adp = new AdaptiveRecommender(recipes)
const as: Array<Swipe> = []
while (as.length < 30)
  for (const r of adp.nextDeck(as, 5))
    as.push({ recipeId: r.id, like: simulateSwipe(user, r) })
console.log('explain:', JSON.stringify(adp.explain(as)))
const truth = trueTopN(user, recipes, 20)
console.log(
  'true top cuisines:',
  truth
    .slice(0, 10)
    .map((id) => recipes.find((r) => r.id === id)?.cuisine)
    .join(','),
)
