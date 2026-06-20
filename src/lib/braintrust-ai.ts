/**
 * Server-only Braintrust tracing for the Vercel AI SDK.
 * See https://www.braintrust.dev/docs/integrations/sdk-integrations/vercel
 */
import { flush, initLogger, traced, wrapAISDK } from 'braintrust'
import * as ai from 'ai'

initLogger({
  projectName: 'My Project',
  // Cloudflare Workers has no Vercel waitUntil; flush before the request ends.
  asyncFlush: false,
})

/** Braintrust span naming passed through wrapAISDK (not in the AI SDK types). */
export type BraintrustSpanInfo = {
  name?: string
  metadata?: Record<string, unknown>
}

const wrapped = wrapAISDK(ai)

export const generateObject =
  wrapped.generateObject as typeof ai.generateObject &
    ((
      args: Parameters<typeof ai.generateObject>[0] & {
        span_info?: BraintrustSpanInfo
      },
    ) => ReturnType<typeof ai.generateObject>)

export const embed = wrapped.embed as typeof ai.embed &
  ((
    args: Parameters<typeof ai.embed>[0] & { span_info?: BraintrustSpanInfo },
  ) => ReturnType<typeof ai.embed>)

export const embedMany = wrapped.embedMany as typeof ai.embedMany &
  ((
    args: Parameters<typeof ai.embedMany>[0] & {
      span_info?: BraintrustSpanInfo
    },
  ) => ReturnType<typeof ai.embedMany>)

export const { streamText, generateText } = wrapped

export { flush, traced }
