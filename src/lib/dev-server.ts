import { createServerFn } from '@tanstack/react-start'

export interface DevStatus {
  openai: boolean
  anthropic: boolean
  resend: boolean
}

/**
 * Which optional API keys are configured locally (booleans only, never the
 * values). Drives the dev-mode warning banner so a collaborator can see at a
 * glance what's stubbed. Only meaningful under `vite dev`; the banner that calls
 * it does not render in the production build.
 */
export const getDevStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DevStatus> => {
    const { readEnv } = await import('./env')
    const has = async (k: string) => Boolean((await readEnv(k))?.trim())
    return {
      openai: await has('OPENAI_API_KEY'),
      anthropic: await has('ANTHROPIC_API_KEY'),
      resend: await has('RESEND_API_KEY'),
    }
  },
)
