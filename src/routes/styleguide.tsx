import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/styleguide')({ component: StyleGuide })

const TOKENS = [
  { name: 'background', label: 'Background' },
  { name: 'foreground', label: 'Foreground' },
  { name: 'primary', label: 'Primary (leaf)' },
  { name: 'accent', label: 'Accent (tomato)' },
  { name: 'secondary', label: 'Secondary' },
  { name: 'muted', label: 'Muted' },
  { name: 'destructive', label: 'Destructive' },
  { name: 'border', label: 'Border' },
] as const

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function StyleGuide() {
  return (
    <main className="mx-auto max-w-4xl space-y-12 px-6 py-16">
      <header className="space-y-2">
        <Badge variant="primary">Design system</Badge>
        <h1 className="text-4xl font-bold tracking-tight">Smart Cart UI</h1>
        <p className="text-muted-foreground">
          The tokens and primitives every Smart Cart screen is built from. Fresh
          leaf-green, warm tomato accent, on a clean canvas.
        </p>
      </header>

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {TOKENS.map((t) => (
            <div key={t.name} className="space-y-2">
              <div
                className="border-border h-16 w-full rounded-lg border"
                style={{ background: `var(--${t.name})` }}
              />
              <p className="text-sm font-medium">{t.label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Plan my week</Button>
          <Button variant="accent">Place order</Button>
          <Button variant="secondary">Swap meal</Button>
          <Button variant="outline">Edit profile</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="destructive">Remove</Button>
          <Button variant="link">Learn more</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-3">
          <Badge>Draft</Badge>
          <Badge variant="primary">Confirmed</Badge>
          <Badge variant="accent">Ordered</Badge>
          <Badge variant="outline">On sale</Badge>
        </div>
      </Section>

      <Section title="Input">
        <div className="max-w-sm space-y-2">
          <Input placeholder="you@example.com" />
          <Input placeholder="Disabled" disabled />
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>This week's plan</CardTitle>
            <CardDescription>
              7 dinners for 2 adults, under €90, no peanuts.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Mon: shakshuka · Tue: miso salmon · Wed: lentil curry · …
          </CardContent>
          <CardFooter className="gap-3">
            <Button>Confirm cart</Button>
            <Button variant="outline">Tweak</Button>
          </CardFooter>
        </Card>
      </Section>
    </main>
  )
}
