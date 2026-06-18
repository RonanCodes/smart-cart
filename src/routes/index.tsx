import { createFileRoute } from '@tanstack/react-router'
import {
  CalendarCheck,
  ShoppingCart,
  Sparkles,
  ThumbsUp,
  ShieldCheck,
} from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'

export const Route = createFileRoute('/')({ component: Home })

const LOOP = [
  { icon: Sparkles, label: 'Learn', note: 'How your household eats' },
  { icon: CalendarCheck, label: 'Plan', note: 'A week of dinners' },
  { icon: ShoppingCart, label: 'Fill basket', note: 'Ready at AH / Jumbo' },
  { icon: ThumbsUp, label: 'Cook & rate', note: 'One tap feedback' },
]

const FEATURES = [
  {
    icon: CalendarCheck,
    title: 'Your week, planned',
    body: 'Open the app to a full week of dinners picked for your household. Swap any meal with one tap.',
  },
  {
    icon: ShoppingCart,
    title: 'A basket in one click',
    body: 'Your menu plus your regulars become one filled basket at Albert Heijn or Jumbo, with the price compared across stores. You check out.',
  },
  {
    icon: Sparkles,
    title: 'Adapts to real life',
    body: 'Tell it "we’re eating out Wednesday" or "the kids hate mushrooms" or "spend twenty euro less" and the whole week replans in seconds.',
  },
  {
    icon: ThumbsUp,
    title: 'Knows you better each week',
    body: 'Thumbs up the meals you liked. Good ones come back, the rest quietly disappear. Every week it fits your household more closely.',
  },
]

function Home() {
  const { data: session } = authClient.useSession()
  const loggedIn = Boolean(session?.user)

  return (
    <div className="bg-background text-foreground">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-bold">
          <ShoppingCart className="text-primary h-6 w-6" />
          Smart Cart
        </span>
        <nav className="flex items-center gap-2">
          <a href="#how">
            <Button variant="ghost" size="sm">
              How it works
            </Button>
          </a>
          {loggedIn ? (
            <a href="/app">
              <Button size="sm">Open app</Button>
            </a>
          ) : (
            <a href="/sign-in">
              <Button size="sm">Get started</Button>
            </a>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pt-10 pb-20 md:grid-cols-2">
        <div className="space-y-6">
          <Badge variant="primary">Your household food planner</Badge>
          <h1 className="text-5xl font-bold tracking-tight text-balance sm:text-6xl">
            Never wonder <span className="text-primary">what's for dinner</span>{' '}
            again.
          </h1>
          <p className="text-muted-foreground max-w-md text-lg text-balance">
            Smart Cart learns how your household eats, plans your week, and
            fills a ready-to-order basket at Albert Heijn or Jumbo in under a
            minute. You just check out.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={loggedIn ? '/app' : '/sign-in'}>
              <Button size="lg">
                {loggedIn ? 'Open app' : 'Plan my first week'}
              </Button>
            </a>
            <a href="#how">
              <Button size="lg" variant="outline">
                See how it works
              </Button>
            </a>
          </div>
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <ShieldCheck className="text-primary h-4 w-4" />
            We never touch your money. Smart Cart plans and fills the basket;
            you check out.
          </p>
        </div>
        <div className="relative">
          <img
            src="/mascot-hero.png"
            alt="The Smart Cart character with a week of groceries"
            className="mx-auto w-full max-w-md"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      </section>

      {/* The loop */}
      <section id="how" className="bg-secondary/40 border-border border-y">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            One loop that gets smarter every week
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-center">
            Most apps stop at suggesting recipes. Smart Cart goes further: it
            learns your household, plans the week, and fills your basket. Every
            week it fits you better.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map((step, i) => (
              <Card key={step.label}>
                <CardContent className="space-y-2 pt-6">
                  <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-lg">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <p className="text-muted-foreground text-xs font-semibold">
                    Step {i + 1}
                  </p>
                  <p className="font-semibold">{step.label}</p>
                  <p className="text-muted-foreground text-sm">{step.note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardContent className="flex gap-4 pt-6">
                <div className="bg-accent/10 text-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
                  <f.icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground text-sm">{f.body}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance">
            Put dinner on the table, automatically.
          </h2>
          <p className="mt-3 opacity-90">
            A Dutch family spends about €150 and five hours a week on groceries.
            Get that time back.
          </p>
          <a href="/sign-in" className="mt-6 inline-block">
            <Button size="lg" variant="secondary">
              Get started free
            </Button>
          </a>
        </div>
      </section>

      <footer className="text-muted-foreground mx-auto flex max-w-6xl items-center justify-between px-6 py-10 text-sm">
        <span>© 2026 Smart Cart</span>
        <span>Made in Amsterdam</span>
      </footer>
    </div>
  )
}
