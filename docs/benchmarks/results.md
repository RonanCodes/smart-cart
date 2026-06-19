# Swipe recommender benchmark

Frozen fixture: `v1` (1531 recipes, rng seed 7). Synthetic users: 300. Deck 5/round, recall@20 vs each user's true top 20. Deterministic, no live DB / no network.

## Recall@20 by swipe count

| strategy     | 5 swipes | 10 swipes | 15 swipes | 20 swipes | 25 swipes | 30 swipes | median swipes to 60% |
| ------------ | -------- | --------- | --------- | --------- | --------- | --------- | -------------------- |
| **random**   | 9%       | 9%        | 9%        | 9%        | 9%        | 10%       | 5 (4% reach)         |
| **maths**    | 4%       | 7%        | 10%       | 9%        | 9%        | 8%        | 15 (0% reach)        |
| **vector**   | 1%       | 2%        | 3%        | 4%        | 8%        | 9%        | 25 (3% reach)        |
| **hybrid**   | 2%       | 3%        | 3%        | 4%        | 7%        | 8%        | 25 (3% reach)        |
| **adaptive** | 8%       | 9%        | 12%       | 10%       | 15%       | 16%       | 15 (9% reach)        |

Higher recall sooner is better. "median swipes to 60%" is the headline: the fewest swipes to a good match.
