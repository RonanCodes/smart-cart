/**
 * Pixverse text-to-video client. Turns a cooking-video prompt into a short MP4.
 * Workers-safe: plain global `fetch`, no SDK. The `PIXVERSE_API_KEY` is a
 * server-only secret, so this module is only pulled in via a dynamic import
 * inside a server fn handler.
 *
 * Two-step flow: submit a generate job (returns a video_id), then poll the
 * result endpoint until the status reports done and a URL is present. Generation
 * is slow (tens of seconds to minutes), so the caller caches the URL and never
 * regenerates (see recipe-media-server).
 *
 * Every request carries a fresh `Ai-trace-id` (the API expects a unique id per
 * call). A known operational state: an out-of-credits account returns ErrCode
 * 500090 with "Insufficient balance" — the caller surfaces that as a clear
 * message and does NOT cache the failure, so a top-up + retry just works.
 */

const BASE = 'https://app-api.pixverse.ai'

/** ErrCode returned when the Pixverse account has no credits left. */
export const PIXVERSE_INSUFFICIENT_BALANCE = 500090

function headers(apiKey: string): Record<string, string> {
  return {
    'API-KEY': apiKey,
    'Ai-trace-id': crypto.randomUUID(),
    'Content-Type': 'application/json',
  }
}

interface GenerateResponse {
  ErrCode?: number
  ErrMsg?: string
  Resp?: { video_id?: number | string }
}

interface ResultResponse {
  ErrCode?: number
  ErrMsg?: string
  Resp?: { status?: number; url?: string }
}

/** Thrown when Pixverse reports an error code; carries the code for the caller. */
export class PixverseError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message)
    this.name = 'PixverseError'
  }
}

/** Submit a text-to-video job. Returns the video_id to poll. */
export async function submitVideo(
  prompt: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(`${BASE}/openapi/v2/video/text/generate`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      prompt,
      model: 'v5',
      duration: 5,
      quality: '540p',
      aspect_ratio: '16:9',
    }),
  })
  if (!res.ok) {
    throw new PixverseError(`Pixverse submit HTTP ${res.status}`, res.status)
  }
  const data: GenerateResponse = await res.json()
  if (data.ErrCode !== 0) {
    throw new PixverseError(
      data.ErrMsg || `Pixverse submit failed (${data.ErrCode})`,
      data.ErrCode ?? -1,
    )
  }
  const id = data.Resp?.video_id
  if (id === undefined) {
    throw new PixverseError('Pixverse returned no video_id', -1)
  }
  return String(id)
}

/** Poll one result. status === 1 means done; url is the finished MP4. */
export async function pollVideo(
  videoId: string,
  apiKey: string,
): Promise<{ status: number; url: string | null }> {
  const res = await fetch(
    `${BASE}/openapi/v2/video/result/${encodeURIComponent(videoId)}`,
    { method: 'GET', headers: headers(apiKey) },
  )
  if (!res.ok) {
    throw new PixverseError(`Pixverse poll HTTP ${res.status}`, res.status)
  }
  const data: ResultResponse = await res.json()
  if (data.ErrCode !== 0) {
    throw new PixverseError(
      data.ErrMsg || `Pixverse poll failed (${data.ErrCode})`,
      data.ErrCode ?? -1,
    )
  }
  return {
    status: data.Resp?.status ?? 0,
    url: data.Resp?.url?.trim() || null,
  }
}

/**
 * Submit then poll until done or timeout. Polls every ~10s for up to ~8 minutes
 * (the documented worst case for a short clip). Returns the finished MP4 URL.
 * Throws PixverseError on any API error (e.g. insufficient balance) or timeout.
 */
export async function generateVideo(
  prompt: string,
  apiKey: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const pollMs = opts.pollMs ?? 10_000
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000
  const videoId = await submitVideo(prompt, apiKey)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { status, url } = await pollVideo(videoId, apiKey)
    if (status === 1 && url) return url
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new PixverseError('Pixverse video timed out', -2)
}

/**
 * Build a short cooking-video prompt from a recipe's title and instructions.
 * Pure, so the prompt shape is unit-testable. Keeps it tight: a hero dish shot
 * with a couple of cooking actions drawn from the real steps, no people, food
 * photography styling, so the clip reads as this dish and not a stock montage.
 */
export function buildCookingPrompt(
  title: string,
  instructions: ReadonlyArray<string>,
): string {
  const steps = instructions
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ')
  const action = steps
    ? ` Show the cooking come together: ${steps}`
    : ' Show the dish being plated.'
  return (
    `A short, appetising cooking video of "${title}".` +
    action +
    ` Warm kitchen light, close-up food photography, steam and fresh ingredients, no text, no people.`
  ).slice(0, 1500)
}
