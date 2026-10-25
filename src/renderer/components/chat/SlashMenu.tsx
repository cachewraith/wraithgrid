// The list above the chat box while a message starts with `/`. The box keeps focus: it
// moves the highlight (↑/↓) and picks (Enter/Tab); the list follows with a sliding highlight.
import { useLayoutEffect, useRef } from 'react'
import { SLASH_GROUP_LABEL, type SlashItem } from '../../lib/slash'

export function slashOptionId(listId: string, i: number): string {
  return `${listId}-o${i}`
}

export function SlashMenu({
  id,
  items,
  active,
  query,
  sigil,
  onPick,
  onHover
}: {
  id: string
  items: SlashItem[]
  active: number
  query: string
  /** What opened it: `/`, or `$` for skills only. */
  sigil: '/' | '$'
  onPick: (item: SlashItem) => void
  onHover: (i: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const ind = useRef<HTMLDivElement>(null)

  // Slide the highlight to the active row and keep that row in view.
  useLayoutEffect(() => {
    const row = ref.current?.querySelector<HTMLElement>(`#${CSS.escape(slashOptionId(id, active))}`)
    const el = ind.current
    if (!row || !el) return
    el.style.transform = `translateY(${row.offsetTop}px)`
    el.style.height = `${row.offsetHeight}px`
    el.style.opacity = '1'
    row.scrollIntoView({ block: 'nearest' })
  }, [id, active, items])

  if (!items.length)
    return (
      <div className="slash" role="status">
        <p className="slash-none">
          No {sigil === '$' ? 'skill' : 'command'} matches “{sigil}
          {query}”.
        </p>
      </div>
    )

  return (
    <div className="slash" ref={ref} id={id} role="listbox" aria-label="Commands">
      <div className="slash-ind" ref={ind} aria-hidden="true" />
      {items.map((it, i) => {
        const head =
          i === 0 || items[i - 1]!.group !== it.group ? SLASH_GROUP_LABEL[it.group] : null
        return (
          <div key={`${it.group}:${it.name}`} className="slash-grp">
            {head && !query ? (
              <div className="slash-hd" aria-hidden="true">
                {head}
              </div>
            ) : null}
            <div
              id={slashOptionId(id, i)}
              role="option"
              aria-selected={i === active}
              className={`slash-it${i === active ? ' on' : ''}`}
              // Keep focus in the box: a mousedown would blur it.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== active && onHover(i)}
              onClick={() => onPick(it)}
            >
              <span className="slash-nm">
                {it.sigil}
                {it.name}
                {it.argumentHint ? <span className="slash-arg"> {it.argumentHint}</span> : null}
              </span>
              {it.source ? <span className="slash-src">{it.source}</span> : null}
              <span className="slash-ds">{it.description}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
