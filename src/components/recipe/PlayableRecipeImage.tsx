import { cn } from '#/lib/utils'

interface PlayableRecipeImageProps {
  /** The recipe hero photo (the still shown everywhere). */
  imageSrc: string
  /**
   * The cached cooking-video URL. RETAINED in the signature so callers (the week
   * recipe sheet) need not change, but IGNORED: the autoplaying clips were
   * tanking desktop scroll, so the recipe hero is now always the still photo
   * (#feedback-and-videos). Safe to remove once no caller passes it.
   */
  videoUrl?: string | null
  /** Alt text for the photo (the dish name). */
  alt: string
  /** Passthrough for the container (the parent sets the aspect + rounding). */
  className?: string
}

/**
 * The recipe hero: always the still photo. It previously autoplayed a silent,
 * looping "living-photo" clip when one was cached, but those clips were tanking
 * desktop scroll performance, so videos were removed (#feedback-and-videos) and
 * the hero is now the plain image everywhere (the week recipe sheet, search /
 * browse, the admin recipe view).
 *
 * Pure + presentational: it fetches nothing; the parent passes the resolved
 * image src. A `/stickers/recipes/` src is treated as a die-cut sticker
 * (object-contain + the `souso-sticker` look); everything else is object-cover.
 */
export function PlayableRecipeImage({
  imageSrc,
  alt,
  className,
}: PlayableRecipeImageProps) {
  const sticker = imageSrc.includes('/stickers/recipes/')
  const box = cn(
    'h-full w-full',
    sticker ? 'souso-sticker object-contain' : 'object-cover',
  )

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <img src={imageSrc} alt={alt} className={box} />
    </div>
  )
}
