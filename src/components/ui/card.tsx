import * as React from 'react'
import { cn } from '#/lib/utils'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * iOS-native card: a larger radius, softer shadow, no hairline border. Use on
   * the mobile app surfaces; the default (bordered) card still suits desktop
   * and the styleguide.
   */
  ios?: boolean
  /** Add press feedback for cards that act as a single tappable target. */
  pressable?: boolean
}

export function Card({ className, ios, pressable, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground',
        ios
          ? 'rounded-[var(--radius-ios)] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]'
          : 'border-border rounded-xl border shadow-sm',
        pressable && 'transition active:scale-[0.985]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-muted-foreground text-sm', className)} {...props} />
  )
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
}
