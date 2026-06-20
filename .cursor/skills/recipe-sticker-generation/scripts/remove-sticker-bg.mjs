#!/usr/bin/env node
/**
 * Remove the white canvas background from generated stickers and rebuild a clean
 * die-cut sticker: tight cutout + uniform white border + soft drop shadow.
 *
 * Why not colorkey / edge-keep tricks:
 *   The model's white border is the SAME white as the canvas and connected to it,
 *   so no color rule can keep just the ring. Instead we eat ALL the white via an
 *   edge-seeded flood fill, then synthesize our own uniform border + shadow. This
 *   is deterministic and consistent across every image.
 *
 * Stickers are generated on a chroma green (#00FF00) canvas (see prompt.txt) so the
 * background is unambiguous and never collides with food/plate/white-border colors.
 *
 * Pipeline:
 *   1. Sample corner pixels -> background color (chroma green)
 *   2. Flood fill from image edges through bg-colored pixels -> alpha 0
 *      (interior green like herbs/veg is enclosed by the plate, so it survives)
 *   3. Green despill on subject pixels near the cutout edge (kills green fringe)
 *   4. Chamfer distance transform outward from the surviving subject
 *   5. Paint a uniform white border ring (dist <= border)
 *   6. Composite a blurred, offset black drop shadow underneath
 *
 * Usage:
 *   node .../remove-sticker-bg.mjs data/.tmp-replicate/stickers/foo-sticker.png
 *   node .../remove-sticker-bg.mjs --all [--tol=14] [--border=24] [--shadow=80]
 *
 * Requires: ffmpeg, ffprobe
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = findRoot(process.cwd())
const IN_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers')
const OUT_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers-transparent')

const DEFAULT_TOL = 14 // bg color match tolerance
const DEFAULT_BORDER = 24 // white die-cut border width (px)
const DEFAULT_SHADOW_ALPHA = 80 // 0-255 max shadow opacity
const SHADOW_OFFSET = 12 // px down-right
const SHADOW_BLUR = 16 // box blur radius

function findRoot(start) {
  let dir = start
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return start
}

function getSize(file) {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${file}"`,
    { encoding: 'utf8' },
  ).trim()
  return out.split(',').map(Number)
}

function loadRgba(file, w, h) {
  return new Uint8Array(
    execSync(`ffmpeg -y -i "${file}" -vf "scale=${w}:${h}:flags=lanczos,format=rgba" -frames:v 1 -f rawvideo -`, {
      maxBuffer: w * h * 4 * 2,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  )
}

function saveRgba(file, rgba, w, h) {
  const tmp = `${file}.raw`
  fs.writeFileSync(tmp, Buffer.from(rgba))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execSync(`ffmpeg -y -f rawvideo -pix_fmt rgba -s ${w}x${h} -i "${tmp}" -frames:v 1 -update 1 "${file}"`, {
    stdio: 'pipe',
  })
  fs.unlinkSync(tmp)
}

function sampleCorners(rgba, w, h) {
  const pts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [1, 1],
    [w - 2, 1],
  ]
  let r = 0
  let g = 0
  let b = 0
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4
    r += rgba[i]
    g += rgba[i + 1]
    b += rgba[i + 2]
  }
  return [Math.round(r / pts.length), Math.round(g / pts.length), Math.round(b / pts.length)]
}

/**
 * Build a background test. For a green-dominant canvas use a chroma-green key
 * (robust to the AI's slightly varying / anti-aliased greens). Otherwise fall
 * back to a tolerance match around the sampled corner color.
 */
function makeBgTest(bg, tol) {
  const greenCanvas = bg[1] > bg[0] + 40 && bg[1] > bg[2] + 40
  if (greenCanvas) {
    return (r, g, b) => g > 90 && g > r + 25 && g > b + 25
  }
  return (r, g, b) =>
    Math.abs(r - bg[0]) <= tol && Math.abs(g - bg[1]) <= tol && Math.abs(b - bg[2]) <= tol
}

/** Flood fill from all four edges through bg-colored pixels. Returns subject mask. */
function floodOuterBg(rgba, w, h, isBg) {
  const isOuter = new Uint8Array(w * h)
  const stack = []

  const seed = (x, y) => {
    const idx = y * w + x
    const i = idx * 4
    if (!isOuter[idx] && isBg(rgba[i], rgba[i + 1], rgba[i + 2])) {
      isOuter[idx] = 1
      stack.push(idx)
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x, 0)
    seed(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    seed(0, y)
    seed(w - 1, y)
  }

  while (stack.length) {
    const idx = stack.pop()
    const x = idx % w
    const y = (idx - x) / w
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const nidx = ny * w + nx
      if (isOuter[nidx]) continue
      const ni = nidx * 4
      if (isBg(rgba[ni], rgba[ni + 1], rgba[ni + 2])) {
        isOuter[nidx] = 1
        stack.push(nidx)
      }
    }
  }

  // subject = everything not reached from the outer edges
  const subject = new Uint8Array(w * h)
  for (let idx = 0; idx < w * h; idx++) subject[idx] = isOuter[idx] ? 0 : 1
  return subject
}

/** Chamfer 3-4 distance transform from subject pixels outward (units: ~3 per px). */
function chamferDistance(subject, w, h) {
  const INF = 1 << 28
  const dist = new Int32Array(w * h)
  for (let idx = 0; idx < w * h; idx++) dist[idx] = subject[idx] ? 0 : INF

  const at = (x, y) => dist[y * w + x]
  // forward
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      let d = dist[idx]
      if (y > 0) d = Math.min(d, at(x, y - 1) + 3)
      if (x > 0) d = Math.min(d, at(x - 1, y) + 3)
      if (x > 0 && y > 0) d = Math.min(d, at(x - 1, y - 1) + 4)
      if (x < w - 1 && y > 0) d = Math.min(d, at(x + 1, y - 1) + 4)
      dist[idx] = d
    }
  }
  // backward
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x
      let d = dist[idx]
      if (y < h - 1) d = Math.min(d, at(x, y + 1) + 3)
      if (x < w - 1) d = Math.min(d, at(x + 1, y) + 3)
      if (x < w - 1 && y < h - 1) d = Math.min(d, at(x + 1, y + 1) + 4)
      if (x > 0 && y < h - 1) d = Math.min(d, at(x - 1, y + 1) + 4)
      dist[idx] = d
    }
  }
  return dist
}

/** Separable box blur on a Float32 alpha plane. */
function boxBlur(src, w, h, radius) {
  if (radius < 1) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = radius * 2 + 1
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win
      const add = src[y * w + Math.min(w - 1, x + radius + 1)]
      const sub = src[y * w + Math.max(0, x - radius)]
      sum += add - sub
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x]
      const sub = tmp[Math.max(0, y - radius) * w + x]
      sum += add - sub
    }
  }
  return out
}

/** Green despill on subject pixels within `reach` px of the cutout edge. */
function greenDespill(rgba, subject, w, h, reach = 3) {
  const edge = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!subject[idx]) continue
      const left = x > 0 ? subject[idx - 1] : 0
      const right = x < w - 1 ? subject[idx + 1] : 0
      const up = y > 0 ? subject[idx - w] : 0
      const down = y < h - 1 ? subject[idx + w] : 0
      if (!left || !right || !up || !down) edge.push(idx)
    }
  }
  const r2 = reach * reach
  for (const e of edge) {
    const ex = e % w
    const ey = (e - ex) / w
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > r2) continue
        const x = ex + dx
        const y = ey + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const idx = y * w + x
        if (!subject[idx]) continue
        const i = idx * 4
        const limit = Math.max(rgba[i], rgba[i + 2])
        if (rgba[i + 1] > limit) rgba[i + 1] = limit
      }
    }
  }
}

function removeBg(rgba, w, h, { tol, border, shadowAlpha }) {
  const bg = sampleCorners(rgba, w, h)
  const isBg = makeBgTest(bg, tol)
  const subject = floodOuterBg(rgba, w, h, isBg)

  // clear flooded background to transparent
  for (let idx = 0; idx < w * h; idx++) {
    if (!subject[idx]) rgba[idx * 4 + 3] = 0
  }

  // kill green fringe on the cutout edge before painting the white border
  greenDespill(rgba, subject, w, h)

  const dist = chamferDistance(subject, w, h)
  const borderUnits = border * 3 // chamfer ~3 per px

  // sticker shape mask (subject + white border) for shadow casting
  const shape = new Float32Array(w * h)
  for (let idx = 0; idx < w * h; idx++) {
    if (dist[idx] <= borderUnits) shape[idx] = 1
  }

  // drop shadow: shape offset down-right, blurred
  const shadowSrc = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - SHADOW_OFFSET
      const sy = y - SHADOW_OFFSET
      if (sx >= 0 && sy >= 0) shadowSrc[y * w + x] = shape[sy * w + sx]
    }
  }
  const shadow = boxBlur(shadowSrc, w, h, SHADOW_BLUR)

  // paint white border ring (transparent pixels within border distance)
  for (let idx = 0; idx < w * h; idx++) {
    if (subject[idx]) continue
    if (dist[idx] <= borderUnits) {
      const i = idx * 4
      rgba[i] = 255
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = 255
    }
  }

  // composite shadow under still-transparent pixels
  for (let idx = 0; idx < w * h; idx++) {
    const i = idx * 4
    if (rgba[i + 3] !== 0) continue
    const a = Math.round(shadow[idx] * shadowAlpha)
    if (a > 2) {
      rgba[i] = 0
      rgba[i + 1] = 0
      rgba[i + 2] = 0
      rgba[i + 3] = Math.min(255, a)
    }
  }

  return { bg }
}

function processFile(inPath, opts) {
  const base = path.basename(inPath)
  const outPath = path.join(OUT_DIR, base)
  const [w, h] = getSize(inPath)
  const rgba = loadRgba(inPath, w, h)
  const { bg } = removeBg(rgba, w, h, opts)
  saveRgba(outPath, rgba, w, h)
  console.log(
    `ok ${path.relative(ROOT, outPath)} (bg ${bg.join(',')}, tol ${opts.tol}, border ${opts.border})`,
  )
}

const args = process.argv.slice(2)
const numArg = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? Number(a.split('=')[1]) : def
}
const opts = {
  tol: numArg('tol', DEFAULT_TOL),
  border: numArg('border', DEFAULT_BORDER),
  shadowAlpha: numArg('shadow', DEFAULT_SHADOW_ALPHA),
}

let files = args.filter((a) => !a.startsWith('--'))
if (args.includes('--all') || files.length === 0) {
  files = fs
    .readdirSync(IN_DIR)
    .filter((f) => f.endsWith('-sticker.png'))
    .map((f) => path.join(IN_DIR, f))
}

if (files.length === 0) {
  console.error('Usage: remove-sticker-bg.mjs <sticker.png> [more...] | --all [--tol=14] [--border=24] [--shadow=80]')
  process.exit(1)
}

for (const file of files) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
  if (!fs.existsSync(abs)) {
    console.error(`missing: ${file}`)
    continue
  }
  processFile(abs, opts)
}
