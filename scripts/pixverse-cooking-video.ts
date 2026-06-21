/**
 * Pixverse AI cooking-video POC. Turns a recipe's steps into one cooking-video
 * prompt, submits it to Pixverse text-to-video, polls until the video is ready,
 * and prints the final video URL. Built for the smart-cart (Souso) hackathon
 * sponsor track.
 *
 * Run it (the API key lives in the gitignored .dev.vars):
 *
 *   set -a; source .dev.vars; set +a; pnpm tsx scripts/pixverse-cooking-video.ts
 *
 * The script also reads .dev.vars itself, so this works too:
 *
 *   pnpm tsx scripts/pixverse-cooking-video.ts
 *
 * Options:
 *   --id <recipeId>      pick a recipe from data/seed/recipes.json (default: first AH recipe)
 *   --steps "a|b|c"      override the steps (pipe-separated), skips the seed file
 *   --title "..."        override the recipe title
 *   --model <model>      Pixverse model (default: v5)
 *   --duration <n>       clip duration in seconds (default: 5)
 *   --quality <q>        e.g. 540p, 720p, 1080p (default: 540p)
 *
 * The final URL and the prompt are saved to scratchpad/pixverse-last.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PIXVERSE_BASE_URL = 'https://app-api.pixverse.ai'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 8 * 60 * 1000
const STATUS_SUCCESS = 1
const MAX_PROMPT_CHARS = 2000

interface SeedRecipe {
  id: string
  source: string
  title: string
  instructions: Array<string>
}

interface SubmitResponse {
  ErrCode: number
  ErrMsg: string
  Resp: { video_id: number } | null
}

interface ResultResponse {
  ErrCode: number
  ErrMsg?: string
  Resp: {
    status: number
    url: string
    prompt: string
    seed: number
  } | null
}

interface CliArgs {
  id?: string
  steps?: string
  title?: string
  model: string
  duration: number
  quality: string
}

function parseArgs(argv: Array<string>): CliArgs {
  const args: CliArgs = { model: 'v5', duration: 5, quality: '540p' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    switch (flag) {
      case '--id':
        args.id = value
        i += 1
        break
      case '--steps':
        args.steps = value
        i += 1
        break
      case '--title':
        args.title = value
        i += 1
        break
      case '--model':
        if (value) args.model = value
        i += 1
        break
      case '--duration':
        if (value) args.duration = Number(value)
        i += 1
        break
      case '--quality':
        if (value) args.quality = value
        i += 1
        break
      default:
        break
    }
  }
  return args
}

/**
 * Load PIXVERSE_API_KEY. Prefer the already-exported env var; otherwise parse
 * .dev.vars from the worktree root so the script runs without a source step.
 */
function loadApiKey(): string {
  const fromEnv = process.env.PIXVERSE_API_KEY
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()

  try {
    const raw = readFileSync(join(process.cwd(), '.dev.vars'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (key !== 'PIXVERSE_API_KEY') continue
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (val.length > 0) return val
    }
  } catch {
    // .dev.vars not present in this worktree, fall through to the error below.
  }

  throw new Error(
    'PIXVERSE_API_KEY not found. Copy the key into .dev.vars (cp ../../.dev.vars .dev.vars) ' +
      'or export PIXVERSE_API_KEY before running.',
  )
}

function pixverseHeaders(apiKey: string): Record<string, string> {
  return {
    'API-KEY': apiKey,
    // A fresh trace id per request: reusing one returns the same cached video.
    'Ai-trace-id': randomUUID(),
    'Content-Type': 'application/json',
  }
}

function loadRecipe(args: CliArgs): { title: string; steps: Array<string> } {
  if (args.steps) {
    const steps = args.steps
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return { title: args.title ?? 'Cooking video', steps }
  }

  const path = join(process.cwd(), 'data', 'seed', 'recipes.json')
  const recipes = JSON.parse(readFileSync(path, 'utf8')) as Array<SeedRecipe>

  let recipe: SeedRecipe | undefined
  if (args.id) {
    recipe = recipes.find((r) => r.id === args.id)
    if (!recipe) throw new Error(`No recipe with id "${args.id}" in ${path}`)
  } else {
    recipe = recipes.find((r) => r.source === 'ah') ?? recipes[0]
    if (!recipe) throw new Error(`No recipes found in ${path}`)
  }

  return {
    title: args.title ?? recipe.title,
    steps: recipe.instructions,
  }
}

/**
 * Build one vivid cooking-video prompt from the title and steps. We compress the
 * steps into a single appetising scene description with top-down and
 * over-the-shoulder shots, and keep it under the char cap.
 */
function buildPrompt(title: string, steps: Array<string>): string {
  const stepText = steps
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' Then, ')

  const prompt = [
    `A warm, appetising cooking video showing how to make "${title}".`,
    `Top-down and over-the-shoulder shots of hands cooking in a bright modern kitchen,`,
    `fresh ingredients sizzling in the pan, steam rising, vibrant colours, shallow depth of field.`,
    `The dish comes together step by step: ${stepText}`,
    `End on a beautifully plated, garnished final dish ready to serve. Cinematic food cinematography, natural light, mouth-watering.`,
  ].join(' ')

  if (prompt.length <= MAX_PROMPT_CHARS) return prompt

  // Too long: keep the framing sentences and truncate the step list cleanly.
  const head = [
    `A warm, appetising cooking video showing how to make "${title}".`,
    `Top-down and over-the-shoulder shots of hands cooking in a bright modern kitchen,`,
    `fresh ingredients sizzling, steam rising, vibrant colours, shallow depth of field.`,
    `The dish comes together step by step: `,
  ].join(' ')
  const tail = ` End on a beautifully plated, garnished final dish. Cinematic food cinematography, natural light, mouth-watering.`
  const room = MAX_PROMPT_CHARS - head.length - tail.length
  const trimmedSteps =
    room > 0 ? stepText.slice(0, Math.max(0, room - 1)).trimEnd() : ''
  return `${head}${trimmedSteps}${tail}`.slice(0, MAX_PROMPT_CHARS)
}

async function submitVideo(
  apiKey: string,
  prompt: string,
  args: CliArgs,
): Promise<number> {
  const body = {
    prompt,
    model: args.model,
    duration: args.duration,
    quality: args.quality,
    aspect_ratio: '16:9',
    motion_mode: 'normal',
    negative_prompt: '',
    seed: 0,
    water_mark: false,
  }

  const res = await fetch(
    `${PIXVERSE_BASE_URL}/openapi/v2/video/text/generate`,
    {
      method: 'POST',
      headers: pixverseHeaders(apiKey),
      body: JSON.stringify(body),
    },
  )

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Submit failed: HTTP ${res.status} ${res.statusText} :: ${text}`,
    )
  }

  const json = JSON.parse(text) as SubmitResponse
  if (json.ErrCode !== 0 || !json.Resp) {
    throw new Error(
      `Submit error ErrCode=${json.ErrCode}: ${json.ErrMsg} :: ${text}`,
    )
  }

  return json.Resp.video_id
}

async function pollResult(apiKey: string, videoId: number): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastStatus: number | undefined

  while (Date.now() < deadline) {
    const res = await fetch(
      `${PIXVERSE_BASE_URL}/openapi/v2/video/result/${videoId}`,
      { method: 'GET', headers: pixverseHeaders(apiKey) },
    )
    const text = await res.text()
    if (!res.ok) {
      throw new Error(
        `Poll failed: HTTP ${res.status} ${res.statusText} :: ${text}`,
      )
    }

    const json = JSON.parse(text) as ResultResponse
    if (json.ErrCode !== 0 || !json.Resp) {
      throw new Error(
        `Poll error ErrCode=${json.ErrCode}: ${json.ErrMsg ?? ''} :: ${text}`,
      )
    }

    const { status, url } = json.Resp
    if (status !== lastStatus) {
      console.log(`status=${status}${url ? ` url=${url}` : ''}`)
      lastStatus = status
    }

    if (status === STATUS_SUCCESS && url) return url

    // Pixverse statuses other than success are either still-generating or a
    // terminal failure (e.g. moderation). Status 5 is the common "generating"
    // value; anything else with no URL after a stable poll is treated as failure.
    if (status !== STATUS_SUCCESS && status !== 5 && status !== 0) {
      throw new Error(
        `Generation ended with non-success status=${status}. Full response: ${text}`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for video ${videoId} (last status=${lastStatus}).`,
  )
}

function saveResult(
  prompt: string,
  url: string,
  videoId: number,
  args: CliArgs,
) {
  const dir = join(process.cwd(), 'scratchpad')
  mkdirSync(dir, { recursive: true })
  const out = {
    videoId,
    url,
    prompt,
    model: args.model,
    duration: args.duration,
    quality: args.quality,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'pixverse-last.json'), JSON.stringify(out, null, 2))
  console.log(`Saved to scratchpad/pixverse-last.json`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = loadApiKey()

  const { title, steps } = loadRecipe(args)
  if (steps.length === 0) {
    throw new Error('Recipe has no steps to build a video from.')
  }
  console.log(`Recipe: ${title} (${steps.length} steps)`)

  const prompt = buildPrompt(title, steps)
  console.log(`\nPrompt (${prompt.length} chars):\n${prompt}\n`)

  console.log(
    `Submitting to Pixverse (model=${args.model} duration=${args.duration}s quality=${args.quality})...`,
  )
  const videoId = await submitVideo(apiKey, prompt, args)
  console.log(`Submitted. video_id=${videoId}. Polling...`)

  const url = await pollResult(apiKey, videoId)
  console.log(`\nDONE. Video URL:\n${url}\n`)
  saveResult(prompt, url, videoId, args)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
