# Swipe recommender benchmark

Catalogue: 666 recipes. Synthetic users: 300. Deck 5/round, recall@20 vs each user's true top 20.

## Recall@20 by swipe count

| strategy     | 5 swipes | 10 swipes | 15 swipes | 20 swipes | 25 swipes | 30 swipes | median swipes to 60% |
| ------------ | -------- | --------- | --------- | --------- | --------- | --------- | -------------------- |
| **random**   | 21%      | 24%       | 26%       | 31%       | 36%       | 51%       | 20 (47% reach)       |
| **maths**    | 10%      | 12%       | 14%       | 12%       | 12%       | 11%       | 5 (1% reach)         |
| **vector**   | 12%      | 18%       | 28%       | 30%       | 35%       | 35%       | 15 (27% reach)       |
| **hybrid**   | 11%      | 17%       | 27%       | 29%       | 34%       | 34%       | 15 (23% reach)       |
| **adaptive** | 22%      | 30%       | 34%       | 37%       | 38%       | 42%       | 10 (43% reach)       |

Higher recall sooner is better. "median swipes to 60%" is the headline: the fewest swipes to a good match.
