import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '#/lib/utils'

/**
 * iOS-style grouped list. `List` is the rounded card container with hairline
 * dividers between rows; `ListRow` is a single 44px+ tappable row with optional
 * leading icon, title/subtitle, trailing content, and a chevron. Mirrors the
 * UITableView "inset grouped" look.
 *
 *   <List>
 *     <ListRow leading={<Bell />} title="Notifications" chevron onClick={...} />
 *     <ListRow title="Diet" subtitle="No peanuts" value="Edit" chevron />
 *   </List>
 */
export function List({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-card border-border divide-border overflow-hidden rounded-[var(--radius-ios)] border',
        'divide-y [&>*]:border-t-0',
        className,
      )}
      {...props}
    />
  )
}

export interface ListRowProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'title'
> {
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  value?: React.ReactNode
  chevron?: boolean
}

export function ListRow({
  leading,
  title,
  subtitle,
  value,
  chevron,
  className,
  onClick,
  ...props
}: ListRowProps) {
  const interactive = Boolean(onClick) || chevron
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive && props.disabled}
      className={cn(
        // 44px minimum touch target; tap feedback via active background.
        'flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left',
        interactive && 'active:bg-secondary/70 transition-colors',
        !interactive && 'cursor-default',
        className,
      )}
      {...props}
    >
      {leading && (
        <span className="text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground block truncate text-sm">
            {subtitle}
          </span>
        )}
      </span>
      {value && (
        <span className="text-muted-foreground shrink-0 text-sm">{value}</span>
      )}
      {chevron && (
        <ChevronRight className="text-muted-foreground/60 h-4 w-4 shrink-0" />
      )}
    </button>
  )
}
