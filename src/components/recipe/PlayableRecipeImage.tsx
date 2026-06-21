import { cn } from '#/lib/utils'

interface PlayableRecipeImageProps {
  /** The recipe hero photo. Shown when there is no video, and used as the
   *  video's poster so the first frame matches the still (seamless start). */
  imageSrc: string
  /** The cached cooking-video URL. When present it autoplays; else just the photo. */
  videoUrl?: string | null
  /** Alt text for the photo (the dish name). */
  alt: string
  /** Passthrough for the container (the parent sets the aspect + rounding). */
  className?: string
}

/**
 * The recipe hero. When the recipe has a cached living-photo clip it autoplays,
 * silent and looping, so the dish is gently alive with no tap needed (the week
 * cards and the open recipe sheet). When there is no clip it is just the photo.
 *
 * The video is muted + playsInline + autoPlay (the only combination iOS Safari
 * will autoplay without a gesture) and loop. It is `pointer-events-none` so it
 * never steals a tap from a parent that is itself a button (the week DayCard taps
 * through to the recipe sheet). poster = the photo so frame 0 matches the still.
 *
 * The clips are pre-boomeranged at hosting (forward + reversed), so a plain loop
 * is seamless. Pure + presentational: it fetches nothing; the parent passes the
 * resolved image src + videoUrl.
 */
export function PlayableRecipeImage({
  imageSrc,
  videoUrl,
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
      {videoUrl ? (
        <video
          src={videoUrl}
          poster={imageSrc}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-label={alt}
          className={cn(box, 'pointer-events-none')}
        />
      ) : (
        <img src={imageSrc} alt={alt} className={box} />
      )}
    </div>
  )
}
