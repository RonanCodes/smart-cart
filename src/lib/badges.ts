/**
 * Fun "what kind of eater are you" badges, derived from the inferred taste profile.
 * These are the visible payoff of the data points: the more a household swipes and
 * gives feedback, the sharper these get.
 */
export interface Badge {
  emoji: string
  label: string
}

const CUISINE_BADGE: Record<string, Badge> = {
  Mexican: { emoji: '🌯', label: 'Burrito lover' },
  Italian: { emoji: '🍝', label: 'Pasta person' },
  Thai: { emoji: '🌶️', label: 'Thai spice seeker' },
  Indian: { emoji: '🍛', label: 'Curry devotee' },
  Chinese: { emoji: '🥡', label: 'Wok star' },
  Japanese: { emoji: '🍣', label: 'Umami hunter' },
  French: { emoji: '🥐', label: 'Francophile palate' },
  British: { emoji: '🫖', label: 'Comfort-food classic' },
  Greek: { emoji: '🫒', label: 'Mediterranean soul' },
  Spanish: { emoji: '🥘', label: 'Tapas type' },
  American: { emoji: '🍔', label: 'Diner heart' },
  Vietnamese: { emoji: '🍜', label: 'Pho fan' },
  Moroccan: { emoji: '🍲', label: 'Tagine traveller' },
  Turkish: { emoji: '🥙', label: 'Mezze maven' },
}

const INGREDIENT_BADGE: Record<string, Badge> = {
  chicken: { emoji: '🍗', label: 'Chicken loyalist' },
  beef: { emoji: '🥩', label: 'Beef believer' },
  lamb: { emoji: '🐑', label: 'Lamb lover' },
  chocolate: { emoji: '🍫', label: 'Chocolate fiend' },
  cheese: { emoji: '🧀', label: 'Cheese person' },
  potato: { emoji: '🥔', label: 'Potato patriot' },
  rice: { emoji: '🍚', label: 'Rice regular' },
  pasta: { emoji: '🍝', label: 'Pasta person' },
  egg: { emoji: '🥚', label: 'Egg enthusiast' },
  spinach: { emoji: '🥬', label: 'Greens grabber' },
}

interface ProfileLike {
  lovedTastes?: Array<string>
  dislikes?: Array<string>
}

export function deriveBadges(profile: ProfileLike): Array<Badge> {
  const out: Array<Badge> = []
  const seen = new Set<string>()
  for (const t of profile.lovedTastes ?? []) {
    const b = CUISINE_BADGE[t] ?? INGREDIENT_BADGE[t.toLowerCase()]
    const badge = b ?? { emoji: '😋', label: `${t} lover` }
    if (!seen.has(badge.label)) {
      seen.add(badge.label)
      out.push(badge)
    }
  }
  return out.slice(0, 6)
}
