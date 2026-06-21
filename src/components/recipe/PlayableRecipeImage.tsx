import { useState } from 'react'
import { Play, X } from 'lucide-react'
import { cn } from '#/lib/utils'

interface PlayableRecipeImageProps {
  /** The recipe hero photo. Always shown; also used as the video's poster so
   *  frame 0 of the clip matches the still and the swap looks seamless. */
  imageSrc: string
  /** The cached cooking-video URL. When null/absent we show only the photo. */
  videoUrl?: string | null
  /** Alt text for the photo (the dish name). */
  alt: string
  /** Passthrough for the container (the parent sets the aspect + rounding). */
  className?: string
}

/**
 * The recipe hero: tap the photo, it becomes the cooking video. The still shows
 * with a small play badge; tapping the badge swaps to an inline <video> whose
 * poster IS the same photo, so frame 0 matches the still and the change reads as
 * the picture coming to life. Tapping the video toggles play/pause, and an X in
 * the corner returns to the still.
 *
 * When there is no videoUrl this is just the photo: no badge, no video. That is
 * the default today, since real Pixverse clips are not generated yet, so the
 * feature degrades cleanly to image-only.
 *
 * Pure + presentational: it fetches nothing. The parent resolves both the image
 * src (the existing recipe imageUrl) and the videoUrl and passes them in.
 *
 * iOS Safari only autoplays a muted, inline video, and only off a user gesture,
 * which the tap provides, so muted + playsInline + autoPlay together make the
 * clip start on the tap. loop keeps the short clip going; preload="metadata"
 * keeps the still cheap until the user asks for the video.
 */
export function PlayableRecipeImage({
  imageSrc,
  videoUrl,
  alt,
  className,
}: PlayableRecipeImageProps) {
  const [playing, setPlaying] = useState(false)

  const box = 'h-full w-full object-cover'

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {playing && videoUrl ? (
        <>
          <video
            src={videoUrl}
            poster={imageSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className={box}
            aria-label={alt}
            onClick={(e) => {
              const v = e.currentTarget
              if (v.paused) void v.play()
              else v.pause()
            }}
          />
          <button
            type="button"
            onClick={() => setPlaying(false)}
            aria-label="Back to photo"
            className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition active:scale-95"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </>
      ) : (
        <>
          <img src={imageSrc} alt={alt} className={box} />
          {videoUrl && (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label="Play recipe video"
              className="absolute inset-0 flex items-center justify-center bg-black/10 transition active:bg-black/20"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition active:scale-95">
                <Play className="ml-0.5 h-7 w-7 fill-current" aria-hidden />
              </span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
