// Thumbnails of the images in a sent chat message (#50). The bubble shows them, and the saved
// view keeps only these: a pasted screenshot can be megabytes, its thumbnail a few dozen KB.
import type { ChatImage } from '@shared/chat'

/** The longest side of a thumbnail, in image pixels (sharp at 2× in a ~240px tile). */
export const THUMB_PX = 480

export const imageDataUrl = (img: ChatImage): string => `data:${img.mediaType};base64,${img.data}`

function blobOf(img: ChatImage): Blob {
  const bin = atob(img.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: img.mediaType })
}

const readDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** One image shrunk to THUMB_PX as WebP; a small image as it is; null if it can't be read. */
async function thumb(img: ChatImage): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blobOf(img))
    const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height))
    if (scale === 1 && img.data.length < 200_000) {
      bmp.close()
      return imageDataUrl(img)
    }
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return await readDataUrl(await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }))
  } catch {
    return null
  }
}

/** Thumbnails in order; an image that can't be read is left out. */
export async function makeThumbs(images: ChatImage[]): Promise<string[]> {
  const out = await Promise.all(images.map(thumb))
  return out.filter((t): t is string => t !== null)
}
