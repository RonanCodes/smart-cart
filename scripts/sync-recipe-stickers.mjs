#!/usr/bin/env node
/**
 * Copy transparent stickers into public/stickers/recipes/{recipeId}.png and
 * update data/seed/recipes.json imageUrl to match.
 *
 * Maps sqlite row id (ah_45139_...) -> catalogue id (ah-R1202259) via recipes.db.
 *
 *   node scripts/sync-recipe-stickers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const DB = path.join(ROOT, 'data/source/recipes.db')
const STICKER_DIR = path.join(ROOT, 'data/.tmp-replicate/stickers-transparent')
const PUBLIC_DIR = path.join(ROOT, 'public/stickers/recipes')
const SEED = path.join(ROOT, 'data/seed/recipes.json')

function loadRecipeMap() {
  const out = execSync(
    `sqlite3 "${DB}" "SELECT id, source, source_id FROM recipes WHERE source IN ('ah','jumbo')"`,
    { encoding: 'utf8' },
  ).trim()
  const map = new Map()
  for (const line of out.split('\n')) {
    if (!line) continue
    const [sqliteId, source, sourceId] = line.split('|')
    map.set(`${source}_${sqliteId}_`, `${source}-${sourceId}`)
  }
  return map
}

function findSticker(prefix) {
  const files = fs.readdirSync(STICKER_DIR)
  const match = files.find(
    (f) => f.startsWith(prefix) && f.endsWith('-sticker.png'),
  )
  return match ? path.join(STICKER_DIR, match) : null
}

function main() {
  if (!fs.existsSync(STICKER_DIR)) {
    console.error(`missing sticker dir: ${STICKER_DIR}`)
    process.exit(1)
  }

  const prefixToRecipeId = loadRecipeMap()
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  const stickerByRecipeId = new Map()
  let copied = 0
  let missing = 0

  for (const [prefix, recipeId] of prefixToRecipeId) {
    const src = findSticker(prefix)
    if (!src) {
      missing++
      continue
    }
    const dest = path.join(PUBLIC_DIR, `${recipeId}.png`)
    fs.copyFileSync(src, dest)
    stickerByRecipeId.set(recipeId, `/stickers/recipes/${recipeId}.png`)
    copied++
  }

  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'))
  let updated = 0
  for (const r of seed) {
    const stickerUrl = stickerByRecipeId.get(r.id)
    if (stickerUrl && r.imageUrl !== stickerUrl) {
      r.imageUrl = stickerUrl
      updated++
    }
  }
  fs.writeFileSync(SEED, JSON.stringify(seed, null, 0) + '\n')

  console.log(`copied ${copied} stickers -> ${path.relative(ROOT, PUBLIC_DIR)}`)
  console.log(`missing stickers for ${missing} catalogue recipes`)
  console.log(
    `updated ${updated} imageUrl entries in ${path.relative(ROOT, SEED)}`,
  )
}

main()
