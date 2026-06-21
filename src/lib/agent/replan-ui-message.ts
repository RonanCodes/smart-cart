import type { UIMessage } from 'ai'
import type { PlannedWeek } from '../planner/types'

/**
 * The typed UI message for the chat replan stream (`POST /api/replan`).
 *
 * Follows the AI SDK UI data-parts pattern so the server can stream a live week
 * (`data-week`, reconciled by id) and a final done payload (`data-done`) alongside
 * the assistant's narration. See https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data
 */
export type ReplanUIMessage = UIMessage<
  never,
  {
    week: { week: PlannedWeek }
    done: { message: string; changed: boolean; planId: string }
  }
>
