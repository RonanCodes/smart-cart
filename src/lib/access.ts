import { readEnv } from './env'
import { parseApprovedList, isApprovedIn } from './access-rules'

export {
  ADMIN_EMAIL,
  NOT_APPROVED_MESSAGE,
  parseApprovedList,
  isApprovedIn,
} from './access-rules'

/**
 * True if `email` may complete sign-in: it is the admin, or it appears in the
 * comma-separated APPROVED_EMAILS env var. Everyone else is waitlisted. This is
 * the env-bound entry point; the pure rules live in access-rules.ts.
 */
export async function isApproved(email: string): Promise<boolean> {
  const approved = parseApprovedList(await readEnv('APPROVED_EMAILS'))
  return isApprovedIn(email, approved)
}
