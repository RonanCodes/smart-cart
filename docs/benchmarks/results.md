# Swipe recommender benchmark

Frozen fixture: `v1` (1531 recipes, rng seed 7). Synthetic users: 300. Deck 5/round, recall@20 vs each user's true top 20. Deterministic, no live DB / no network.

## Recall@20 by swipe count

| strategy     | 5 swipes | 10 swipes | 15 swipes | 20 swipes | 25 swipes | 30 swipes | median swipes to 60% |
| ------------ | -------- | --------- | --------- | --------- | --------- | --------- | -------------------- |
| **random**   | 7%       | 7%        | 7%        | 7%        | 7%        | 7%        | 5 (4% reach)         |
| **maths**    | 2%       | 10%       | 6%        | 4%        | 4%        | 3%        | n/a (0% reach)       |
| **vector**   | 1%       | 1%        | 1%        | 2%        | 6%        | 12%       | 30 (6% reach)        |
| **hybrid**   | 1%       | 1%        | 1%        | 2%        | 6%        | 12%       | 30 (6% reach)        |
| **adaptive** | 9%       | 7%        | 8%        | 16%       | 18%       | 21%       | 15 (23% reach)       |

Higher recall sooner is better. "median swipes to 60%" is the headline: the fewest swipes to a good match.
