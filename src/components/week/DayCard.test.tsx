import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DayCard } from './DayCard'
import type { WeekDayView } from '#/lib/week-server'

/**
 * jsdom does not implement Pointer Capture; the swipe calls
 * `setPointerCapture`/`releasePointerCapture` on the dish button. Stub them so a
 * pointer drag in the test reaches the same code path the browser runs (without
 * these the move handler throws and the swipe silently never commits — which is
 * exactly the class of regression these tests guard).
 */
beforeAll(() => {
  if (!('setPointerCapture' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    })
  }
  if (!('releasePointerCapture' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    })
  }
})

afterEach(cleanup)

function makeDay(over: Partial<WeekDayView> = {}): WeekDayView {
  return {
    day: 'Monday',
    meal: 'Spaghetti Bolognese',
    recipeRef: 'recipe-1',
    cuisine: 'Italian',
    prepMinutes: 30,
    calories: 600,
    protein: 35,
    imageUrl: 'https://example.com/spag.png',
    videoUrl: null,
    alternatives: [],
    ...over,
  }
}

function makeAlt(over: Partial<WeekDayView> = {}): WeekDayView {
  return makeDay({
    meal: 'Chicken Curry',
    recipeRef: 'recipe-2',
    imageUrl: 'https://example.com/curry.png',
    ...over,
  })
}

const noopProps = {
  busy: false,
  locked: false,
  onEdit: () => {},
  onAdd: () => {},
  onLoadSimilar: async () => [],
  onPickSimilar: async () => {},
  rating: null,
  ratingNote: null,
  ratingBusy: false,
  onRate: async () => {},
}

/** Find the draggable dish button (the one whose label opens the recipe). */
function dishButton(meal: string) {
  return screen.getByRole('button', { name: new RegExp(`Open .*${meal}`) })
}

/** Drag the dish left past the commit threshold, then release. */
function swipeLeft(el: HTMLElement, distance = -120) {
  fireEvent.pointerDown(el, { clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: 200 + distance, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: 200 + distance, pointerId: 1 })
}

describe('DayCard swipe-to-swap', () => {
  it('a swipe on a day with a deck commits onSwapTo to the next alternative', () => {
    const onSwapTo = vi.fn()
    render(
      <DayCard
        {...noopProps}
        day={makeDay()}
        swapOptions={[makeDay(), makeAlt()]}
        onSwap={() => {}}
        onSwapTo={onSwapTo}
      />,
    )
    swipeLeft(dishButton('Spaghetti Bolognese'))
    expect(onSwapTo).toHaveBeenCalledWith('recipe-2')
  })

  it('a swipe on a day with no deck fires onSwap (the server-side replace)', () => {
    const onSwap = vi.fn()
    render(
      <DayCard
        {...noopProps}
        day={makeDay()}
        swapOptions={undefined}
        onSwap={onSwap}
        onSwapTo={() => {}}
      />,
    )
    swipeLeft(dishButton('Spaghetti Bolognese'))
    expect(onSwap).toHaveBeenCalledTimes(1)
  })

  it('a short drag (below the trigger) does not commit a swap', () => {
    const onSwapTo = vi.fn()
    render(
      <DayCard
        {...noopProps}
        day={makeDay()}
        swapOptions={[makeDay(), makeAlt()]}
        onSwap={() => {}}
        onSwapTo={onSwapTo}
      />,
    )
    swipeLeft(dishButton('Spaghetti Bolognese'), -20)
    expect(onSwapTo).not.toHaveBeenCalled()
  })

  it('a drag does not also open the recipe (a swipe is not a tap)', () => {
    const onEdit = vi.fn()
    render(
      <DayCard
        {...noopProps}
        day={makeDay()}
        swapOptions={[makeDay(), makeAlt()]}
        onSwap={() => {}}
        onSwapTo={() => {}}
        onEdit={onEdit}
      />,
    )
    const dish = dishButton('Spaghetti Bolognese')
    swipeLeft(dish)
    fireEvent.click(dish)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('still swaps when setPointerCapture throws (some in-app webviews do)', () => {
    // The root cause Nicolas hit: some mobile in-app webviews throw from
    // setPointerCapture. An unguarded call threw out of the move handler, so the
    // drag was never tracked and the swipe silently never committed. Guarding the
    // call keeps the swipe working everywhere.
    const original = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'setPointerCapture',
    )
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      value: () => {
        throw new Error('InvalidStateError: pointer not capturable')
      },
      configurable: true,
    })
    try {
      const onSwapTo = vi.fn()
      render(
        <DayCard
          {...noopProps}
          day={makeDay()}
          swapOptions={[makeDay(), makeAlt()]}
          onSwap={() => {}}
          onSwapTo={onSwapTo}
        />,
      )
      swipeLeft(dishButton('Spaghetti Bolognese'))
      expect(onSwapTo).toHaveBeenCalledWith('recipe-2')
    } finally {
      if (original)
        Object.defineProperty(Element.prototype, 'setPointerCapture', original)
    }
  })
})

describe('week screen swipe-to-swap copy matches behaviour', () => {
  // Read the week route as source text (not imported — it pulls in server-only
  // modules). The behaviour tests above prove a swipe fires the swap handler;
  // these assertions keep the screen copy honest about that gesture so the UI
  // never promises a swipe that does not swap (the bug in #409).
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'src/routes/_authed.week.tsx'),
    'utf8',
  )

  it('the week subtitle promises swipe-to-swap (the gesture the card supports)', () => {
    expect(routeSrc.toLowerCase()).toContain('swipe a dish to swap it')
  })

  it('the swipe the copy promises is actually wired (onSwapTo + onSwap passed to DayCard)', () => {
    expect(routeSrc).toContain('onSwapTo={cbs.onSwapTo}')
    expect(routeSrc).toContain('onSwap={cbs.onSwap}')
  })
})
