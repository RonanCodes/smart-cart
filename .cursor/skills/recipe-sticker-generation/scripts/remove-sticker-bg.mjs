#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = findRoot(process.cwd())
const IN_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers')
const OUT_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers-transparent')
const DEFAULT_TOL = 14
const DEFAULT_BORDER = 24
const DEFAULT_SHADOW_ALPHA = 80
const SHADOW_OFFSET = 12
const SHADOW_BLUR = 16

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
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.raw`
  fs.writeFileSync(tmp, Buffer.from(rgba))
  execSync(`ffmpeg -y -f rawvideo -pix_fmt rgba -s ${w}x${h} -i "${tmp}" -frames:v 1 -update 1 "${file}"`, {
    stdio: 'pipe',
  })
  fs.unlinkSync(tmp)
}

function sampleCorners(rgba, w, h) {
  const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [1, 1], [w - 2, 1]]
  let r = 0, g = 0, b = 0
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4
    r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]
  }
  return [Math.round(r / pts.length), Math.round(g / pts.length), Math.round(b / pts.length)]
}

function makeBgTest(bg, tol) {
  const greenCanvas = bg[1] > bg[0] + 40 && bg[1] > bg[2] + 40
  if (greenCanvas) {
    // Screen green only — reject darker/yellower food greens (curry, beans, herbs)
    return (r, g, b) => g > 120 && g - Math.max(r, b) > 55
  }
  return (r, g, b) =>
    Math.abs(r - bg[0]) <= tol && Math.abs(g - bg[1]) <= tol && Math.abs(b - bg[2]) <= tol
}

function floodOuterBg(rgba, w, h, isBg) {
  const isOuter = new Uint8Array(w * h)
  const visited = new Uint8Array(w * h)
  const stack = []

  const seed = (x, y) => {
    const idx = y * w + x
    if (visited[idx]) return
    const i = idx * 4
    if (isBg(rgba[i], rgba[i + 1], rgba[i + 2])) stack.push(idx)
  }
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1) }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y) }

  while (stack.length) {
    const idx = stack.pop()
    if (visited[idx]) continue
    visited[idx] = 1
    isOuter[idx] = 1
    const x = idx % w
    const y = (idx - x) / w
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const nidx = ny * w + nx
      if (visited[nidx]) continue
      const ni = nidx * 4
      if (isBg(rgba[ni], rgba[ni + 1], rgba[ni + 2])) stack.push(nidx)
    }
  }

  const subject = new Uint8Array(w * h)
  for (let idx = 0; idx < w * h; idx++) subject[idx] = isOuter[idx] ? 0 : 1
  return subject
}

function chamferDistance(subject, w, h) {
  const INF = 1 << 28
  const dist = new Int32Array(w * h)
  for (let idx = 0; idx < w * h; idx++) dist[idx] = subject[idx] ? 0 : INF
  const at = (x, y) => dist[y * w + x]
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
      sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]
    }
  }
  return out
}

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
    const ex = e % w, ey = (e - ex) / w
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > r2) continue
        const x = ex + dx, y = ey + dy
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
  for (let idx = 0; idx < w * h; idx++) if (!subject[idx]) rgba[idx * 4 + 3] = 0
  greenDespill(rgba, subject, w, h)
  const dist = chamferDistance(subject, w, h)
  const borderUnits = border * 3
  const shape = new Float32Array(w * h)
  for (let idx = 0; idx < w * h; idx++) if (dist[idx] <= borderUnits) shape[idx] = 1
  const shadowSrc = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - SHADOW_OFFSET, sy = y - SHADOW_OFFSET
      if (sx >= 0 && sy >= 0) shadowSrc[y * w + x] = shape[sy * w + sx]
    }
  }
  const shadow = boxBlur(shadowSrc, w, h, SHADOW_BLUR)
  for (let idx = 0; idx < w * h; idx++) {
    if (subject[idx]) continue
    if (dist[idx] <= borderUnits) {
      const i = idx * 4
      rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255
    }
  }
  for (let idx = 0; idx < w * h; idx++) {
    const i = idx * 4
    if (rgba[i + 3] !== 0) continue
    const a = Math.round(shadow[idx] * shadowAlpha)
    if (a > 2) { rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = Math.min(255, a) }
  }
  return { bg }
}

function processFile(inPath, opts) {
  const outPath = path.join(OUT_DIR, path.basename(inPath))
  const [w, h] = getSize(inPath)
  const rgba = loadRgba(inPath, w, h)
  removeBg(rgba, w, h, opts)
  saveRgba(outPath, rgba, w, h)

  let transparent = 0
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) transparent++
  const pct = ((transparent / (w * h)) * 100).toFixed(1)
  if (transparent === 0) console.warn(`WARN ${path.basename(inPath)}: no transparent pixels`)
  console.log(`ok ${path.relative(ROOT, outPath)} (${pct}% transparent)`)
}

const args = process.argv.slice(2)
const numArg = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? Number(a.split('=')[1]) : def
}
const opts = { tol: numArg('tol', DEFAULT_TOL), border: numArg('border', DEFAULT_BORDER), shadowAlpha: numArg('shadow', DEFAULT_SHADOW_ALPHA) }

let files = args.filter((a) => !a.startsWith('--'))
if (args.includes('--all') || files.length === 0) {
  files = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('-sticker.png')).map((f) => path.join(IN_DIR, f))
}

for (const file of files) {
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
  if (!fs.existsSync(abs)) { console.error(`missing: ${file}`); continue }
  processFile(abs, opts)
}
