import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from './auth'

export interface SessionUser {
  id: string
  email: string
  name: string
}

/**
 * Read the signed-in user from the request cookies on the server. Returns undefined
 * for signed-out requests. Used in route `beforeLoad` guards so a signed-out visitor
 * never renders a gated page (auth-guards canon).
 */
export async function getSessionUser(): Promise<SessionUser | undefined> {
  const request = getRequest()
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return undefined
  const u = session.user as { id: string; email: string; name?: string }
  return { id: u.id, email: u.email, name: u.name ?? u.email }
}
