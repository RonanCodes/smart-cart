import { describe, it, expect, beforeEach } from 'vitest'
import { FUNNEL_EVENTS, buildEventProps, stripPii } from './analytics'
import { TRACE_STORAGE_KEY, isTraceId } from './trace'

describe('FUNNEL_EVENTS', () => {
  it('covers the whole product funnel with stable snake_case names', () => {
    expect(FUNNEL_EVENTS).toMatchObject({
      userLoggedIn: 'user_logged_in',
      onboardingStarted: 'onboarding_started',
      onboardingCompleted: 'onboarding_completed',
      onboardingRestarted: 'onboarding_restarted',
      voiceOnboardingStarted: 'voice_onboarding_started',
      weekBuilt: 'week_built',
      recipeSwapped: 'recipe_swapped',
      recipeOpened: 'recipe_opened',
      addedToCart: 'added_to_cart',
      cartUpdated: 'cart_updated',
      storeSelected: 'store_selected',
      orderClicked: 'order_clicked',
      tipDialogOpened: 'tip_dialog_opened',
      tipSelected: 'tip_selected',
      ahCartOpened: 'ah_cart_opened',
    })
  })

  it('has no duplicate event strings', () => {
    const values = Object.values(FUNNEL_EVENTS)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('stripPii', () => {
  it('drops email and known PII keys', () => {
    expect(
      stripPii({ householdSize: 3, email: 'a@b.co', store: 'ah' }),
    ).toEqual({ householdSize: 3, store: 'ah' })
  })

  it('drops nested name/address/phone keys but keeps safe analytics props', () => {
    expect(
      stripPii({
        store: 'ah',
        name: 'Ada',
        address: '1 Main St',
        phone: '0612345678',
        planSize: 7,
      }),
    ).toEqual({ store: 'ah', planSize: 7 })
  })

  it('returns an empty object for no props', () => {
    expect(stripPii(undefined)).toEqual({})
    expect(stripPii({})).toEqual({})
  })

  it('keeps a hashed/opaque id but never the raw email', () => {
    expect(stripPii({ userId: 'usr_1', email: 'a@b.co' })).toEqual({
      userId: 'usr_1',
    })
  })
})

describe('buildEventProps', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('attaches a valid traceId', () => {
    const props = buildEventProps({ store: 'ah' })
    expect(isTraceId(props.traceId)).toBe(true)
    expect(props.store).toBe('ah')
  })

  it('reuses the session trace id across events', () => {
    const a = buildEventProps()
    const b = buildEventProps()
    expect(a.traceId).toBe(b.traceId)
    expect(window.sessionStorage.getItem(TRACE_STORAGE_KEY)).toBe(a.traceId)
  })

  it('strips PII from the supplied props', () => {
    const props = buildEventProps({ email: 'a@b.co', store: 'jumbo' })
    expect(props.email).toBeUndefined()
    expect(props.store).toBe('jumbo')
  })

  it('never throws on a bad props object and still returns a traceId', () => {
    const props = buildEventProps(null)
    expect(isTraceId(props.traceId)).toBe(true)
  })
})
