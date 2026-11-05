import { useEffect, useRef, useState, type RefObject } from 'react'
import { IS_MAC, SHORTCUT_HINT, isReplyKey } from '../../app/shortcuts'
import { fenceCode } from '../../lib/quotes'
import { IconReply } from '../icons'

// Select text in the chat, then Reply (#164): a small button over the selection hands it to
// the message box as a quote. Copying the selection works as before; the button only adds.

const elOf = (n: Node): Element | null => (n.nodeType === 1 ? (n as Element) : n.parentElement)

/** The selection, when it starts in one of this chat's messages and has text; else null. */
function chatRange(root: HTMLElement | null): Range | null {
  const sel = window.getSelection()
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!elOf(r.startContainer)?.closest('.chat-it') || !root.contains(r.endContainer)) return null
  if (!root.contains(r.startContainer) || !sel.toString().trim()) return null
  return r
}

const codeLang = (pre: Element): string => {
  const l = pre.closest('.md-code')?.querySelector('.md-code-h span')?.textContent ?? ''
  return l === 'text' ? '' : l
}

/** The selected text with its line breaks, code blocks fenced, copy buttons and labels left out. */
function rangeText(r: Range): string {
  const pre = elOf(r.commonAncestorContainer)?.closest('pre')
  if (pre) return fenceCode(r.toString(), codeLang(pre))
  const frag = r.cloneContents()
  frag.querySelectorAll('.md-code-h, .md-copy, .cmsg-tools').forEach((n) => n.remove())
  frag.querySelectorAll('pre').forEach((p) => {
    const fenced = document.createElement('pre')
    fenced.textContent = fenceCode(p.textContent ?? '', codeLang(p))
    p.replaceWith(fenced)
  })
  // innerText (not textContent) keeps the breaks between blocks; it needs the box laid out.
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;white-space:normal'
  box.append(frag)
  document.body.append(box)
  const text = box.innerText
  box.remove()
  return text
}

export function ReplyButton({
  root,
  onReply
}: {
  /** The chat's scroll box: only selections in its messages count. */
  root: RefObject<HTMLElement | null>
  onReply: (text: string) => void
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const replyRef = useRef(onReply)
  useEffect(() => {
    replyRef.current = onReply
  })

  useEffect(() => {
    const scroller = root.current
    let pressed = false
    const place = (): void => {
      const r = chatRange(scroller)
      // Placed in the chat's own box (`.chat`, position: relative), above the selection.
      const frame = scroller?.parentElement?.getBoundingClientRect()
      if (!r || !frame) return setAt(null)
      const box = r.getBoundingClientRect()
      // Under the chat's top edge even when the selection starts above it (button 28px + gap).
      setAt({ x: box.left + box.width / 2 - frame.left, y: Math.max(box.top - frame.top, 36) })
    }
    const reply = (r: Range): void => {
      const text = rangeText(r)
      window.getSelection()?.removeAllRanges()
      setAt(null)
      if (text.trim()) replyRef.current(text)
    }
    // Shown once the mouse lets go (not while dragging out the selection); a keyboard
    // selection (Shift+arrows) shows it as it changes.
    const onChange = (): void => {
      if (!pressed) place()
    }
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && btnRef.current?.contains(e.target)) return
      pressed = true
    }
    const onUp = (): void => {
      if (!pressed) return
      pressed = false
      // After the browser has settled the selection (a click inside it clears it then).
      setTimeout(place, 0)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAt(null)
      else if (isReplyKey(e, IS_MAC)) {
        const r = chatRange(scroller)
        if (!r) return
        e.preventDefault()
        e.stopPropagation()
        reply(r)
      }
    }
    const onClick = (): void => {
      const r = chatRange(scroller)
      if (r) reply(r)
    }
    const onScroll = (): void => setAt(null)
    const btn = btnRef.current
    document.addEventListener('selectionchange', onChange)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    window.addEventListener('keydown', onKey, true)
    scroller?.addEventListener('scroll', onScroll)
    btn?.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('keydown', onKey, true)
      scroller?.removeEventListener('scroll', onScroll)
      btn?.removeEventListener('click', onClick)
    }
  }, [root])

  return (
    <button
      ref={btnRef}
      className="chat-reply"
      aria-label="Reply to the selected text"
      title={`Reply (${SHORTCUT_HINT.reply})`}
      hidden={!at}
      style={at ? { left: at.x, top: at.y } : undefined}
      // Keep the selection: a press would clear it before the click.
      onMouseDown={(e) => e.preventDefault()}
    >
      <IconReply small />
      Reply
    </button>
  )
}
