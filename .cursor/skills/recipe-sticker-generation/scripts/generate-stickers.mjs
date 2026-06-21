#!/usr/bin/env node
/**
 * Generate recipe stickers via Replicate google/nano-banana-2.
 *
 * Usage:
 *   node .cursor/skills/recipe-sticker-generation/scripts/generate-stickers.mjs data/images/foo.jpg
 *   node .cursor/skills/recipe-sticker-generation/scripts/generate-stickers.mjs data/images/*.jpg
 *
 * Env: REPLICATE_API_TOKEN in .dev.vars (read automatically)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ROOT = findRoot(process.cwd())
const PROMPT_FILE = path.join(SKILL_DIR, 'prompt.txt')
const SM_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers-sm')
const OUT_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers')
const MODEL = 'google/nano-banana-2'

function findRoot(start) {
  let dir = start
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return start
}

function loadToken() {
  const vars = fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8')
  const m = vars.match(/^REPLICATE_API_TOKEN=(.+)$/m)
  if (!m) throw new Error('REPLICATE_API_TOKEN not found in .dev.vars')
  return m[1].trim().replace(/^"|"$/g, '')
}

function resize(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel)
  const base = path.basename(abs)
  fs.mkdirSync(SM_DIR, { recursive: true })
  const out = path.join(SM_DIR, base)
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(abs).mtimeMs) {
    execSync(`sips -s format jpeg -s formatOptions 80 -Z 1024 "${abs}" --out "${out}"`, {
      stdio: 'pipe',
    })
  }
  return out
}

function dataUrl(file) {
  const b = fs.readFileSync(file)
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function poll(token, url) {
  for (let i = 0; i < 90; i++) {
    const body = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()
    if (body.status === 'succeeded') return body
    if (body.status === 'failed' || body.status === 'canceled') {
      throw new Error(body.error || body.status)
    }
    await sleep(2000)
  }
  throw new Error('poll timeout')
}

async function generate(token, imagePath, prompt) {
  const abs = path.isAbsolute(imagePath) ? imagePath : path.join(ROOT, imagePath)
  const base = path.basename(abs, path.extname(abs))
  const outPath = path.join(OUT_DIR, `${base}-sticker.png`)
  const sm = resize(abs)

  const input = {
    prompt,
    image_input: [dataUrl(sm)],
    aspect_ratio: '1:1',
    resolution: '1K',
    output_format: 'png',
    google_search: false,
    image_search: false,
  }

  console.log(`generating ${base}...`)
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  })
  const created = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(created))

  const body = await poll(token, created.urls.get)
  const url = typeof body.output === 'string' ? body.output : body.output[0]
  const img = await fetch(url)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(outPath, Buffer.from(await img.arrayBuffer()))
  console.log(`saved ${path.relative(ROOT, outPath)}`)
  return outPath
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (args.length === 0) {
  console.error('Usage: generate-stickers.mjs <image-path> [more...]')
  process.exit(1)
}

const prompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim()
const token = loadToken()

for (const imagePath of args) {
  if (!fs.existsSync(path.isAbsolute(imagePath) ? imagePath : path.join(ROOT, imagePath))) {
    console.error(`missing: ${imagePath}`)
    continue
  }
  try {
    await generate(token, imagePath, prompt)
  } catch (err) {
    console.error(`failed ${imagePath}:`, err.message)
  }
}
