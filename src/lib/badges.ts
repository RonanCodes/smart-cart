/**
 * Fun "what kind of eater are you" badges, derived from the household profile.
 *
 * The onboarding FORM (not a swipe deck) is now the data source, so badges come
 * from the explicit form answers: the cuisines the user said they love, their
 * diet, and their goals. Legacy swipe-derived `lovedTastes` is still read so a
 * household onboarded before the form switch keeps its badges.
 */
export interface Badge {
  emoji: string
  label: string
}

/** Title-case a single cuisine token so 'italian' matches the 'Italian' keys. */
function titleCaseCuisine(s: string): string {
  const t = s.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/**
 * One badge per diet the form can set on the profile. The persisted `diet` is a
 * single string ('vegan' | 'vegetarian'); the form may also carry exclusion-only
 * diets in the goals/labels, but only the tag-diet lands here, so map those two.
 */
const DIET_BADGE: Record<string, Badge> = {
  vegan: { emoji: '🌱', label: 'Plant-powered' },
  vegetarian: { emoji: '🥗', label: 'Veggie-first' },
}

/**
 * One badge per onboarding goal label. Keys are the exact labels the form
 * writes (see goals-step OPTIONS); an unmatched goal is skipped rather than
 * guessed at, to avoid nonsense badges.
 */
const GOAL_BADGE: Record<string, Badge> = {
  'eat a more balanced diet': { emoji: '⚖️', label: 'Balance seeker' },
  'pay less for my groceries': { emoji: '💸', label: 'Budget cook' },
  'lighten the mental load': { emoji: '🧠', label: 'Low-effort planner' },
  'cook and discover new recipes': { emoji: '🧑‍🍳', label: 'Recipe explorer' },
  'avoid unnecessary purchases': { emoji: '🛒', label: 'Waste-not shopper' },
  'eat less meat': { emoji: '🌿', label: 'Meat-light' },
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
  /** Cuisines the user said they love in the form (normalised, lowercased). */
  cuisinesLiked?: Array<string>
  /** Single diet string the form collapsed to ('vegan' | 'vegetarian'). */
  diet?: string
  /** Soft goal labels the user picked in the form. */
  goals?: Array<string>
  /** Legacy swipe-derived loved cuisines/ingredients (pre-form households). */
  lovedTastes?: Array<string>
  dislikes?: Array<string>
}

/**
 * Derive the badge set from a household profile.
 *
 * Order matters for the 6-badge cap: cuisine taste first (the headline), then
 * a diet badge, then goal badges. Cuisines come from the form's `cuisinesLiked`
 * when present, falling back to the legacy swipe `lovedTastes` so older
 * households still render. Labels are deduped, capped at six.
 */
export function deriveBadges(profile: ProfileLike): Array<Badge> {
  const out: Array<Badge> = []
  const seen = new Set<string>()
  const push = (badge: Badge) => {
    if (seen.has(badge.label)) return
    seen.add(badge.label)
    out.push(badge)
  }

  // Cuisines: prefer the explicit form answers, fall back to legacy swipe data.
  const cuisineTokens =
    profile.cuisinesLiked && profile.cuisinesLiked.length
      ? profile.cuisinesLiked
      : (profile.lovedTastes ?? [])
  for (const raw of cuisineTokens) {
    const b =
      CUISINE_BADGE[titleCaseCuisine(raw)] ??
      INGREDIENT_BADGE[raw.toLowerCase()]
    push(b ?? { emoji: '😋', label: `${titleCaseCuisine(raw)} lover` })
  }

  // A diet badge so a form user who picked vegan/vegetarian gets a payoff even
  // with no liked cuisines.
  if (profile.diet) {
    const d = DIET_BADGE[profile.diet.toLowerCase()]
    if (d) push(d)
  }

  // Goal badges last — they round out a sparse profile without drowning taste.
  for (const g of profile.goals ?? []) {
    const gb = GOAL_BADGE[g.toLowerCase().trim()]
    if (gb) push(gb)
  }

  return out.slice(0, 6)
}
