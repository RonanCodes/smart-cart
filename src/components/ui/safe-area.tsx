import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * SafeArea — a layout wrapper that pads its content past the device notch and
 * home indicator using the `env(safe-area-inset-*)` values (exposed as the
 * `--safe-*` CSS vars in styles.css). Requires `viewport-fit=cover` on the meta
 * viewport, which __root.tsx sets.
 *
 * `edges` picks which insets to apply. Default is top + horizontal: a screen
 * that sits *inside* the AppShell wants top/left/right but NOT bottom, because
 * the tab bar already owns the home-indicator gap. A full-screen route with no
 * tab bar (onboarding, sign-in) passes `edges={['top','bottom','left','right']}`.
 */
export type SafeEdge = 'top' | 'bottom' | 'left' | 'right'

const EDGE_STYLE: Record<SafeEdge, React.CSSProperties> = {
  top: { paddingTop: 'var(--safe-top)' },
  bottom: { paddingBottom: 'var(--safe-bottom)' },
  left: { paddingLeft: 'var(--safe-left)' },
  right: { paddingRight: 'var(--safe-right)' },
}

export interface SafeAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  edges?: Array<SafeEdge>
  asChild?: never
}

export function SafeArea({
  edges = ['top', 'left', 'right'],
  className,
  style,
  ...props
}: SafeAreaProps) {
  const insetStyle = edges.reduce<React.CSSProperties>(
    (acc, edge) => ({ ...acc, ...EDGE_STYLE[edge] }),
    {},
  )
  return (
    <div
      className={cn('min-h-dvh', className)}
      style={{ ...insetStyle, ...style }}
      {...props}
    />
  )
}
