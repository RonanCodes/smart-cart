import { describe, expect, it, vi } from 'vitest'
import { missingFromListForPlan } from './week-missing-cta'

describe('missingFromListForPlan (#week-cta-swap)', () => {
  it('returns the refreshed missing count for the adopted plan', async () => {
    const countMissing = vi.fn().mockResolvedValue({ missing: 3 })
    await expect(
      missingFromListForPlan('plan-revision-2', countMissing),
    ).resolves.toBe(3)
    expect(countMissing).toHaveBeenCalledWith('plan-revision-2')
  })

  it('coerces a failed count to 0 (#384)', async () => {
    const countMissing = vi.fn().mockResolvedValue(undefined)
    await expect(missingFromListForPlan('plan-1', countMissing)).resolves.toBe(
      0,
    )
  })
})
