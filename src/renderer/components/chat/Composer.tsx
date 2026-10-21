import { useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import {
  CHAT_IMAGE_MAX,
  CHAT_IMAGE_TYPES,
  CHAT_IMAGES_MAX,
  type ChatImage,
  type ChatImageType
} from '@shared/chat'
import { IconArrowUp, IconClose, IconStop } from '../icons'
import { rankSlash, slashQuery, type SlashItem } from '../../lib/slash'
import { SlashMenu, slashOptionId } from './SlashMenu'

interface Props {
  placeholder: string
  /** The process is up; before that (and after it ended) nothing can be sent. */
  ready: boolean
  busy: boolean
  /** Take keyboard focus (the pane was focused). */
  autoFocus: boolean
  /** Shown under the box: the folder, and so on. */
  meta: string[]
  /** The model picker, first in the row under the box. */
  model?: ReactNode
  /** The `/` menu's items; empty: no menu. */
  commands?: SlashItem[]
  /** A Wraithgrid or terminal-only command was picked (the box is cleared). */
  onCommand?: (item: SlashItem) => void
  /** Shift+Tab: the next permission mode, as in Claude Code. */
  onCycleMode?: () => void
  onSend: (text: string, images: ChatImage[]) => void
  onStop: () => void
}

/** Reads a pasted image as base64, or null when it is too big or not a kind agents take. */
function readImage(file: File): Promise<ChatImage | null> {
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      const data = String(r.result).replace(/^data:[^,]*,/, '')
      resolve(
        data.length <= CHAT_IMAGE_MAX ? { mediaType: file.type as ChatImageType, data } : null
      )
    }
    r.onerror = () => resolve(null)
    r.readAsDataURL(file)
  })
}

export function Composer({
  placeholder,
  ready,
  busy,
  autoFocus,
  meta,
  model,
  commands = [],
  onCommand,
  onCycleMode,
  onSend,
  onStop
}: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ChatImage[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId().replace(/:/g, '')

  // The `/` menu: open while the first word starts with `/` and the caret is in it.
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const query = commands.length ? slashQuery(text, caret) : null
  const open = query !== null && dismissed !== text
  const items = open ? rankSlash(commands, query) : []
  const [active, setActive] = useState(0)
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    setActive(0)
  }
  const syncCaret = (): void => setCaret(ref.current?.selectionStart ?? 0)

  const pick = (item: SlashItem): void => {
    if (item.group === 'app' || item.group === 'terminal') {
      setText('')
      onCommand?.(item)
      return
    }
    const next = `/${item.name} `
    setText(next)
    setCaret(next.length)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(next.length, next.length)
    })
  }

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const canSend = ready && (text.trim().length > 0 || images.length > 0)
  const send = (): void => {
    if (!canSend) return
    onSend(text.trim(), images)
    setText('')
    setImages([])
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (!files.length) return
    e.preventDefault()
    void Promise.all(files.map(readImage)).then((read) =>
      setImages((cur) =>
        [...cur, ...read.filter((x): x is ChatImage => !!x)].slice(0, CHAT_IMAGES_MAX)
      )
    )
  }

  return (
    <div className={`cc${busy ? ' busy' : ''}`}>
      {open ? (
        <SlashMenu
          id={listId}
          items={items}
          active={active}
          query={query ?? ''}
          onPick={pick}
          onHover={setActive}
        />
      ) : null}
      <div className="cc-box">
        {images.length ? (
          <div className="cc-imgs">
            {images.map((img, i) => (
              <div key={i} className="cc-img">
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt={`Pasted image ${i + 1}`}
                />
                <button
                  aria-label="Remove image"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  <IconClose small />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={ready ? placeholder : 'Starting…'}
          aria-label="Message"
          spellCheck
          role={commands.length ? 'combobox' : undefined}
          aria-expanded={commands.length ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-autocomplete={commands.length ? 'list' : undefined}
          aria-activedescendant={open && items.length ? slashOptionId(listId, active) : undefined}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
          }}
          onSelect={syncCaret}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (open && items.length && !e.nativeEvent.isComposing) {
              const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
              if (step) {
                e.preventDefault()
                setActive((active + step + items.length) % items.length)
                return
              }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault()
                pick(items[active]!)
                return
              }
            }
            if (e.key === 'Tab' && e.shiftKey && onCycleMode && !open) {
              e.preventDefault()
              onCycleMode()
              return
            }
            if (open && e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setDismissed(text)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            } else if (e.key === 'Escape' && busy) {
              e.preventDefault()
              onStop()
            }
          }}
        />
        <div className="cc-row">
          <div className="cc-meta">
            {model}
            {meta.filter(Boolean).map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
          {busy ? (
            <button
              className="cc-btn stop"
              aria-label="Stop (Esc)"
              title="Stop (Esc)"
              onClick={onStop}
            >
              <IconStop small />
            </button>
          ) : null}
          <button
            className="cc-btn send"
            aria-label="Send (Enter)"
            title={busy ? 'Queue message (Enter)' : 'Send (Enter)'}
            disabled={!canSend}
            onClick={send}
          >
            <IconArrowUp small />
          </button>
        </div>
      </div>
    </div>
  )
}
