import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../icons'

// One full-window viewer for chat images: a sent message's (#50) and the message box's
// pasted ones before sending (#163).

/** One image over the whole window: Esc or a click closes it, ← → step through the list. */
export function ImageViewer({
  images,
  at,
  onMove,
  onClose
}: {
  images: string[]
  at: number
  onMove: (i: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => prev?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && at > 0) onMove(at - 1)
      else if (e.key === 'ArrowRight' && at < images.length - 1) onMove(at + 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at, images.length, onClose, onMove])
  const label = images.length > 1 ? `Image ${at + 1} of ${images.length}` : 'Image'
  return createPortal(
    <div
      className="chat-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <img src={images[at]} alt={label} draggable={false} />
      <button ref={closeRef} className="chat-viewer-close" aria-label="Close image">
        <IconClose />
      </button>
      {images.length > 1 ? <span className="chat-viewer-count">{label}</span> : null}
    </div>,
    document.body
  )
}
