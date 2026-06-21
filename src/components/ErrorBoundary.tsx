import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { UtensilsCrossed } from 'lucide-react'
import { log } from '#/lib/log'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

/**
 * App-wide React error boundary. Catches render/lifecycle errors anywhere below
 * it, logs them (-> Workers Logs via the client ship), and shows a recoverable
 * fallback instead of a blank white screen. Mounted at the root around <Outlet/>.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('react.error_boundary', error, {
      componentStack: info.componentStack,
    })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <div
          className="bg-secondary text-primary flex h-16 w-16 items-center justify-center rounded-full"
          aria-hidden
        >
          <UtensilsCrossed className="h-7 w-7" />
        </div>
        <p className="text-sm font-medium">Something went wrong.</p>
        <p className="text-muted-foreground text-xs">
          We&apos;ve logged it. Try reloading.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-medium active:scale-95"
        >
          Reload
        </button>
      </div>
    )
  }
}
