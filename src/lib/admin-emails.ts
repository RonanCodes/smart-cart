import { ADMIN_EMAIL, parseApprovedList } from './access-rules'

/**
 * The full set of admin emails, trim+lowercase normalised. Sourced from the
 * ADMIN_EMAILS Worker secret (comma-separated) plus the always-included default
 * owner, so the console + notifications can never lock everyone out. This is the
 * single source the /admin gate and the waitlist notifier both resolve admins
 * from. Async because the env read goes through cloudflare:workers in prod.
 */
export async function resolveAdminEmails(): Promise<Array<string>> {
  const { readEnv } = await import('./env')
  const set = parseApprovedList(await readEnv('ADMIN_EMAILS'))
  set.add(ADMIN_EMAIL)
  return [...set]
}
