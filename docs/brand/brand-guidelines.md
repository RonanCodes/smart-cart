# Souso brand guidelines

Souso is your sous chef for recipes and the weekly shop. The brand is warm,
calm, and a little hand-made: a personal recipe book, not a supermarket flyer.
The look is the "Julienne / Souso" system: a cream ground, one olive accent,
die-cut food stickers, and the odd hand-written note.

## Palette

Hex is the source of truth (mirrored into the CSS tokens in `src/styles.css`).

| Token                             | Hex                        | Use                                                                    |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| Ground (`--background`)           | `#F5F1E7`                  | The cream canvas. Everything sits on it.                               |
| Ink (`--foreground`)              | `#16341F`                  | Dark olive. All text + outlines.                                       |
| Olive (`--primary`)               | `#6F9135`                  | The single brand accent + primary action. One green, used with intent. |
| On-olive (`--primary-foreground`) | `#FFFFFF`                  | Text/icons on the olive.                                               |
| Card                              | `#FFFFFF`                  | Raised surfaces (cards, sheets, inputs).                               |
| Secondary                         | `#EBEFDC`                  | Pale sage fill (icon tiles, chips, sticker backplates).                |
| Muted                             | `#EFE9DA` / text `#7C8473` | Parchment fills + secondary text.                                      |
| Amber (`--accent`)                | `#E8A33D`                  | Warm highlight for bonus / appetising moments. Sparingly.              |
| Lime (`--lime`)                   | `#A7C552`                  | Fresh secondary green. Rare.                                           |
| Note paper (`--note`)             | `#F8EFCB`                  | The hand-written sticky-note paper.                                    |
| Border (`--border`)               | `#E6E0D1`                  | Hairlines + input borders.                                             |

Rule of thumb: cream ground, white cards, olive for the one thing you want
tapped. Amber is a seasoning, not a base.

## Type

- **Outfit** (self-hosted, weights 300-800): all UI text and headings. Tight
  tracking on big headings (around `-0.02em` to `-0.03em`).
- **Schoolbell** (`--font-handwriting`): the hand-written notes only (the
  `StickyNote` plakkertjes). Never body or primary UI text.

## The sticker style (signature)

Food and product art are **die-cut stickers**: a transparent PNG with a thick
white outline traced round the cut-out and a soft green-tinted drop shadow, set
at a small rotation so it reads as hand-placed. This is the `souso-sticker`
utility in `src/styles.css`. Recipe stickers live in
`public/stickers/recipes/`, ingredient stickers in
`public/stickers/ingredients/`. Pair them with the pale-sage backplate for
list rows.

## Shape + depth

- Radius: rounded and friendly. Base `--radius` `0.75rem`; pills and tiles go
  fully round. Cards use the iOS radius.
- Shadows: soft and low. Cards get a faint lift; stickers carry the green-tinted
  shadow. No hard or neon shadows.
- Spacing: generous. One centred focus per screen, lots of cream around it.

## Mascot

Souso, the little chef character. The current set is `public/brand/souso-v3-*`
(plain, hello, love, celebrate, think); `souso-v3-plain` is the canonical pose.
Used for empty states, the share card, and warmth. Reactions stay positive:
encouraging, never sad or scolding. The earlier 2D/hat/mascot drafts are archived
under `public/archive/`; don't reach for those.

## Logo

`public/souso-mark.svg` (olive on cream) and `public/souso-logo.svg` (white,
for dark/olive grounds). Keep clear space around it; don't recolour it outside
the olive/white pair.

## No emoji in product UI

Icons are Lucide; warmth comes from the stickers, the mascot, and Schoolbell
notes, not from emoji. (Emoji in this doc's prose is fine; the shipped UI uses
none.)
