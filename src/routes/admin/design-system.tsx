import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'

/**
 * /admin/design-system: a living style guide for the Souso brand. The palette,
 * type, the die-cut sticker treatment, the mascot, the core components, and the
 * voice do/don't. Renders the REAL tokens + components so it can't drift from the
 * app. The written guidelines live in docs/brand/. Admin-gated by the /admin
 * layout's beforeLoad.
 */

export const Route = createFileRoute('/admin/design-system')({
  component: DesignSystem,
})

/** [css token, hex, human label]. Hex is the source of truth (src/styles.css). */
const PALETTE: ReadonlyArray<readonly [string, string, string]> = [
  ['--background', '#F5F1E7', 'Ground / cream'],
  ['--foreground', '#16341F', 'Ink / dark olive'],
  ['--primary', '#6F9135', 'Olive (primary action)'],
  ['--secondary', '#EBEFDC', 'Pale sage'],
  ['--muted', '#EFE9DA', 'Parchment'],
  ['--muted-foreground', '#7C8473', 'Muted text'],
  ['--accent', '#E8A33D', 'Amber (sparingly)'],
  ['--lime', '#A7C552', 'Lime'],
  ['--note', '#F8EFCB', 'Note paper'],
  ['--border', '#E6E0D1', 'Border / hairline'],
  ['--card', '#FFFFFF', 'Card surface'],
]

const VOICE_DO = [
  '"Groceries, sorted."',
  '"Swipe a dish to swap it."',
  '"6 ingredients reused, nothing left over."',
  'Warm, plain, calm. Reward, never guilt.',
]
const VOICE_DONT = [
  'AI-tell filler: leverage, seamless, unlock, elevate, streamline.',
  'Em-dashes or en-dashes.',
  'Guilt or pressure ("Don’t miss out", sad mascot).',
  '"It’s not just X, it’s Y" reversals; gratuitous tricolons.',
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2
        className="mb-3 text-lg font-bold"
        style={{ letterSpacing: '-0.02em' }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function DesignSystem() {
  return (
    <div className="px-4 pb-16 sm:px-6">
      <p className="text-muted-foreground mb-8 max-w-2xl text-sm">
        The Souso design system, rendered from the real tokens + components so
        it can&rsquo;t drift. The written guidelines + voice live in{' '}
        <code className="bg-secondary rounded px-1.5 py-0.5 text-xs">
          docs/brand/
        </code>
        .
      </p>

      <Section title="Palette">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {PALETTE.map(([token, hex, label]) => (
            <div
              key={token}
              className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm"
            >
              <div className="h-16 w-full" style={{ background: hex }} />
              <div className="p-2.5">
                <p className="text-[0.8rem] font-semibold">{label}</p>
                <p className="text-muted-foreground font-mono text-[0.7rem]">
                  {hex} · {token}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="border-border bg-card space-y-2 rounded-2xl border p-5 shadow-sm">
          <p
            className="text-[2rem] font-bold"
            style={{ letterSpacing: '-0.03em' }}
          >
            Outfit: Groceries, sorted.
          </p>
          <div className="text-foreground flex flex-wrap gap-x-5 gap-y-1">
            <span className="font-light">Light 300</span>
            <span className="font-normal">Regular 400</span>
            <span className="font-medium">Medium 500</span>
            <span className="font-semibold">Semibold 600</span>
            <span className="font-bold">Bold 700</span>
            <span className="font-extrabold">Extrabold 800</span>
          </div>
          <p className="font-handwriting text-2xl">
            Schoolbell, for the hand-written notes
          </p>
        </div>
      </Section>

      <Section title="Sticker style">
        <div className="border-border bg-card flex flex-wrap items-center gap-6 rounded-2xl border p-5 shadow-sm">
          <img
            src="/stickers/recipes/chicken-orzo.png"
            alt="Recipe sticker"
            className="souso-sticker h-28 w-28 object-contain"
            style={{ transform: 'rotate(-4deg)' }}
          />
          <img
            src="/stickers/ingredients/tomato.png"
            alt="Ingredient sticker"
            className="souso-sticker h-20 w-20 object-contain"
            style={{ transform: 'rotate(-3deg)' }}
          />
          <p className="text-muted-foreground max-w-xs text-sm">
            Die-cut: a thick white outline round the cut-out + a soft
            green-tinted shadow, set at a small rotation. Utility{' '}
            <code className="bg-secondary rounded px-1 text-xs">
              .souso-sticker
            </code>
            .
          </p>
        </div>
      </Section>

      <Section title="Mascot">
        <div className="border-border bg-card flex flex-wrap items-center gap-6 rounded-2xl border p-5 shadow-sm">
          <figure className="m-0 flex flex-col items-center gap-1.5">
            <img
              src="/brand/souso-v3-plain.png"
              alt="Souso, calm and resting"
              className="h-24 w-24 object-contain"
            />
            <figcaption className="text-muted-foreground text-xs">
              Plain (canonical)
            </figcaption>
          </figure>
          <figure className="m-0 flex flex-col items-center gap-1.5">
            <img
              src="/brand/souso-v3-celebrate.png"
              alt="Souso celebrating, arms up with a basil leaf"
              className="h-24 w-24 object-contain"
            />
            <figcaption className="text-muted-foreground text-xs">
              Celebrate (a reward moment)
            </figcaption>
          </figure>
          <p className="text-muted-foreground max-w-xs text-sm">
            Souso, the little chef. The v3 set lives in{' '}
            <code className="bg-secondary rounded px-1 text-xs">
              public/brand/souso-v3-*
            </code>{' '}
            (plain, hello, love, celebrate, think). Empty states, the share
            card, a bit of warmth. Reactions stay positive, never sad or
            scolding.
          </p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="border-border bg-card space-y-4 rounded-2xl border p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="max-w-xs">
            <Button size="pill">Full-width pill CTA</Button>
          </div>
        </div>
      </Section>

      <Section title="Notes, chips & cards">
        <div className="border-border bg-card flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-sm">
          <StickyNote>a keeper &#10038;</StickyNote>
          <span className="border-border bg-card text-muted-foreground inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm">
            chip
          </span>
          <span className="text-primary text-[0.64rem] font-bold tracking-[0.16em] uppercase">
            eyebrow label
          </span>
          <span className="rounded-md border border-[#f1ce8e] bg-[#fbe6c2] px-1.5 py-0.5 text-[0.62rem] font-extrabold tracking-wide text-[#7a4d10] uppercase">
            Bonus
          </span>
        </div>
      </Section>

      <Section title="Voice & tone">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#cfe0a8] bg-[#f3f7e6] p-4">
            <h3 className="text-primary mb-2 text-sm font-bold">Do</h3>
            <ul className="text-foreground/80 space-y-1.5 text-sm">
              {VOICE_DO.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
          <div className="border-border bg-muted/40 rounded-2xl border p-4">
            <h3 className="text-muted-foreground mb-2 text-sm font-bold">
              Don&rsquo;t
            </h3>
            <ul className="text-foreground/80 space-y-1.5 text-sm">
              {VOICE_DONT.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  )
}
