import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground">
        Built at Megathon Amsterdam · team Day42
      </span>
      <h1 className="text-5xl font-bold tracking-tight text-balance sm:text-6xl">
        Your household groceries,{' '}
        <span className="text-primary">done for you</span>.
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground text-balance">
        Smart Cart learns how your household eats, plans the week, and places
        your real order at Albert Heijn or Jumbo. Automated, with control.
      </p>
      <div className="flex gap-3">
        <a
          href="/sign-in"
          className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Get started
        </a>
        <a
          href="/styleguide"
          className="rounded-lg border border-border px-6 py-3 font-semibold transition hover:bg-secondary"
        >
          Design system
        </a>
      </div>
    </main>
  )
}
