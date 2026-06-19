import { RotateCcw } from 'lucide-react'
import type { AdaptiveWeights } from '#/lib/recsys/types'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'

/**
 * Numeric inputs bound to the Adaptive ranker's tunable constants. Each field maps
 * to one AdaptiveWeights value; a "reset to default" button puts every input back to
 * the committed defaults so a tuning session is never lost mid-experiment.
 */
export function WeightControls({
  weights,
  defaults,
  onChange,
}: {
  weights: AdaptiveWeights
  defaults: AdaptiveWeights
  onChange: (w: AdaptiveWeights) => void
}) {
  function setTop(
    key: 'idfGate' | 'dislikedCuisinePenalty' | 'ingredientMagnitude',
    v: number,
  ) {
    onChange({ ...weights, [key]: v })
  }
  function setSoft(key: 'calorie' | 'protein' | 'prep', v: number) {
    onChange({ ...weights, soft: { ...weights.soft, [key]: v } })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Adaptive weights</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(defaults)}
          className="h-7 px-2 text-xs"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
      </div>

      <NumberField
        label="idf gate"
        value={weights.idfGate}
        step={0.01}
        onChange={(v) => setTop('idfGate', v)}
      />
      <NumberField
        label="disliked cuisine penalty"
        value={weights.dislikedCuisinePenalty}
        step={0.1}
        onChange={(v) => setTop('dislikedCuisinePenalty', v)}
      />
      <NumberField
        label="ingredient magnitude"
        value={weights.ingredientMagnitude}
        step={0.1}
        onChange={(v) => setTop('ingredientMagnitude', v)}
      />

      <p className="text-muted-foreground pt-1 text-xs font-medium tracking-wide uppercase">
        Soft nudge
      </p>
      <NumberField
        label="calorie"
        value={weights.soft.calorie}
        step={0.05}
        onChange={(v) => setSoft('calorie', v)}
      />
      <NumberField
        label="protein"
        value={weights.soft.protein}
        step={0.05}
        onChange={(v) => setSoft('protein', v)}
      />
      <NumberField
        label="prep"
        value={weights.soft.prep}
        step={0.05}
        onChange={(v) => setSoft('prep', v)}
      />
    </div>
  )
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? n : 0)
        }}
        className="h-8 w-24 text-right text-sm"
      />
    </label>
  )
}
