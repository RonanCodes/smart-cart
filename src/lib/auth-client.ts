import { createAuthClient } from 'better-auth/react'
import { emailOTPClient, magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  // magicLinkClient matches the server magicLink plugin so the `/magic-link/verify`
  // route is registered and the typed `signIn.magicLink` helper is available
  // (issue #259). Links themselves are generated server-side; the client plugin
  // is needed so verification resolves on the same auth instance.
  plugins: [emailOTPClient(), magicLinkClient()],
})

export const { signIn, signOut, useSession } = authClient
