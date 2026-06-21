---
name: recipe-sticker-generation
description: Generate photorealistic recipe sticker PNGs from food photos via Replicate nano-banana-2 on a chroma-green canvas, then key out the green to transparent PNGs with a synthesized white die-cut border and drop shadow. Use when creating recipe stickers, stickerizing dish images, batch-generating AH/Jumbo recipe assets, or removing sticker backgrounds.
---

# Recipe sticker generation

Turn recipe photos into transparent sticker PNGs: **generate** the dish on chroma green (Replicate) → **key out green** and synthesize a clean white die-cut border + shadow.

## Prerequisites

- `REPLICATE_API_TOKEN` in `.dev.vars`
- `ffmpeg` + `ffprobe` (macOS: `brew install ffmpeg`)
- `sips` (macOS built-in, for resize)

## Quick start

```bash
# 1. Generate dish on chroma-green canvas
node .cursor/skills/recipe-sticker-generation/scripts/generate-stickers.mjs \
  data/images/ah_45123_Macaroni-ovenschotel_met_kip.jpg

# 2. Key out green -> transparent + synthesized white border + shadow
node .cursor/skills/recipe-sticker-generation/scripts/remove-sticker-bg.mjs --all
```

**Outputs**

| Step | Directory |
|------|-----------|
| Generated (green bg) | `data/.tmp-replicate/stickers/` |
| Transparent | `data/.tmp-replicate/stickers-transparent/` |
| Resized inputs | `data/.tmp-replicate/stickers-sm/` |

Naming: `{recipe-basename}-sticker.png`

## Prompt

Canonical prompt: [prompt.txt](prompt.txt)

Keep it generic — do not dish-specify ingredients. Key points:

- Remove everything that is not **food and plate**
- Render the isolated dish centered on **pure chroma green `#00FF00`** with even margin (so it never touches the edges)
- **No** white border / shadow from the model — those are synthesized in step 2 for consistency

### Prompt tweaks (one-offs)

**Decorative under-plate / charger tray** — add to prompt:

```
Do NOT include decorative serving plates, charger plates, or trays underneath the bowl.
Keep ONLY the immediate bowl/plate the food sits in.
```

## Generation settings

| Setting | Value |
|---------|-------|
| Model | `google/nano-banana-2` |
| Not | `google/nano-banana-pro` (E9243 failures in practice) |
| `aspect_ratio` | `1:1` |
| `resolution` | `1K` |
| `output_format` | `png` |
| Input resize | max 1024px via `sips` before upload |

## Background removal

Why chroma green + synthesized border: the model's own white border is the same
white as a white canvas (can't be keyed cleanly), and a radius/bbox keep-mask
leaves a halo on round plates. Green is unambiguous and we draw the border ourselves.

Pipeline ([remove-sticker-bg.mjs](scripts/remove-sticker-bg.mjs)):

1. Sample corner pixels → background color; build a **chroma-green key** (robust to AI's varying greens)
2. **Flood fill** green from the image edges → transparent (interior green like herbs is enclosed by the plate, so it survives)
3. **Green despill** on subject pixels within a few px of the cut edge (clamp `G` to `max(R,B)`) — kills green fringe, same idea as ffmpeg `despill`
4. **Chamfer distance** transform outward from the subject
5. Paint a **uniform white border** ring (`dist <= --border`)
6. Composite a blurred, offset **black drop shadow** underneath

Tune if needed:

```bash
node .cursor/skills/recipe-sticker-generation/scripts/remove-sticker-bg.mjs \
  data/.tmp-replicate/stickers/foo-sticker.png --border=28 --shadow=90 --tol=18
```

| Flag | Default | Effect |
|------|---------|--------|
| `--border` | 24 | white die-cut border width (px) |
| `--shadow` | 80 | max drop-shadow opacity (0–255) |
| `--tol` | 14 | bg tolerance (only used if canvas isn't green-dominant) |

## Batch workflow

```bash
node .cursor/skills/recipe-sticker-generation/scripts/generate-stickers.mjs \
  data/images/ah_45123_*.jpg \
  data/images/ah_45143_*.jpg

node .cursor/skills/recipe-sticker-generation/scripts/remove-sticker-bg.mjs --all
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Green fringe on edges | despill `reach` is small; nudge up in script, or regenerate with purer `#00FF00` |
| Green halo / bg not removed | Model drew muddy green; regenerate emphasizing "pure solid chroma green #00FF00, flat" |
| Border too thick/thin | `--border=N` |
| Shadow too strong/weak | `--shadow=N` (0 disables) |
| Interior green veg removed | Only happens if it touches the edge; ensure margin in prompt so plate encloses it |
| Extra decorative plate | Regenerate with under-plate prompt tweak |
| Multiple split stickers | Add "one single sticker, keep full composition together" |
| Replicate E9243 on pro | Use `nano-banana-2` |
