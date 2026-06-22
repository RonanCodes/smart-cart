import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlayableRecipeImage } from './PlayableRecipeImage'

describe('PlayableRecipeImage', () => {
  it('renders the still <img> and never a <video>, even with a videoUrl', () => {
    // Videos were removed (#feedback-and-videos) because the autoplaying clips
    // tanked desktop scroll. Passing a videoUrl must still render only the photo.
    const { container } = render(
      <PlayableRecipeImage
        imageSrc="/photos/pasta.jpg"
        videoUrl="/videos/pasta.mp4"
        alt="Pasta pomodoro"
      />,
    )
    expect(container.querySelector('video')).toBeNull()
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/photos/pasta.jpg')
    expect(img?.getAttribute('alt')).toBe('Pasta pomodoro')
  })

  it('renders the still <img> when there is no videoUrl', () => {
    const { container } = render(
      <PlayableRecipeImage imageSrc="/photos/soup.jpg" alt="Soup" />,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/photos/soup.jpg',
    )
  })

  it('applies the sticker object-fit for a /stickers/recipes/ src', () => {
    const { container } = render(
      <PlayableRecipeImage
        imageSrc="/stickers/recipes/curry.png"
        alt="Curry"
      />,
    )
    const img = container.querySelector('img')
    expect(img?.className).toContain('souso-sticker')
    expect(img?.className).toContain('object-contain')
  })

  it('uses object-cover for a normal photo src', () => {
    const { container } = render(
      <PlayableRecipeImage imageSrc="/photos/tacos.jpg" alt="Tacos" />,
    )
    const img = container.querySelector('img')
    expect(img?.className).toContain('object-cover')
    expect(img?.className).not.toContain('souso-sticker')
  })
})
