import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './push-client'

describe('urlBase64ToUint8Array', () => {
  it('decodes a standard base64url string to the right bytes', () => {
    // "hello" -> base64 "aGVsbG8="; base64url drops padding -> "aGVsbG8"
    const bytes = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111])
  })

  it('handles the url-safe alphabet (- and _) like + and /', () => {
    // bytes [255, 224] -> base64 "/+A=" -> base64url "_-A"
    const bytes = urlBase64ToUint8Array('_-A')
    expect(Array.from(bytes)).toEqual([255, 224])
  })

  it('tolerates a string that needs no padding', () => {
    // "test" decodes cleanly with padding restored
    const bytes = urlBase64ToUint8Array('dGVzdA')
    expect(Array.from(bytes)).toEqual([116, 101, 115, 116])
  })
})
