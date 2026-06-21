import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '#/components/marketing/Landing'

/**
 * DESIGN PREVIEW (throwaway) — /design/landing. Renders the public marketing
 * Landing without the / auth redirect, so the waitlist page can be reviewed in
 * dev (where the dev-admin is always "signed in"). Delete with the design.*
 * routes before shipping.
 */
export const Route = createFileRoute('/design/landing')({
  component: Landing,
})
