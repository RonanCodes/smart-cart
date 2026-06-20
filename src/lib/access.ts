import { readEnv } from './env'
import { parseApprovedList, isApprovedWith, grantMapFrom } from './access-rules'

export {
  ADMIN_EMAIL,
  NOT_APPROVED_MESSAGE,
  parseApprovedList,
  isApprovedIn,
} from './access-rules'

/**
 * Load the DB-backed grant map (normalised email -> role). Dynamically imports
 * the DB client + schema so this stays out of the client bundle and the pure
 * access-rules module never pulls in cloudflare:workers. Returns an empty map if
 * the table is unavailable (e.g. migration not yet applied), so a missing grant
 * table degrades to env-only access rather than locking everyone out.
 */
async function loadGrantMap() {
  try {
    const { getDb } = await import('../db/client')
    const { accessGrant } = await import('../db/access-grant-schema')
    const db = await getDb()
    const rows = await db
      .select({ email: accessGrant.email, role: accessGrant.role })
      .from(accessGrant)
    return grantMapFrom(rows)
  } catch {
    return grantMapFrom([])
  }
}

/**
 * True if `email` may complete sign-in: it is the admin, it appears in the
 * comma-separated APPROVED_EMAILS env var, OR it has any access_grant row (a
 * 'user' or 'admin' grant from the admin console). This is the env + DB bound
 * entry point; the pure rules live in access-rules.ts.
 */
export async function isApproved(email: string): Promise<boolean> {
  const approved = parseApprovedList(await readEnv('APPROVED_EMAILS'))
  const grants = await loadGrantMap()
  return isApprovedWith(email, approved, grants)
}
