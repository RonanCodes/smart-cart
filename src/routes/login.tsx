import { createFileRoute } from '@tanstack/react-router'
import { LoginForm } from '#/components/auth/LoginForm'

/**
 * /login: the un-advertised entry for approved users. Renders the same
 * email-OTP login form as /sign-in. Not linked from the public landing; you get
 * here by knowing the URL. Access is still gated server-side: only approved
 * emails can complete sign-in.
 */
export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  return <LoginForm />
}
