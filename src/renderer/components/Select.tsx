// Theme-aware listbox for short choices (#75). Focus stays on the trigger so modal focus
// traps and keyboard navigation work even though the options portal outside clipped panels.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevron } from './icons'

interface Props {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}

export function Select({ label, value, options, onChange, disabled }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, maxHeight: 240 })
  const selected = options.findIndex((o) => o.value === value)
  const show = (): void => {
    setActive(Math.max(0, selected))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const r = trigger.current?.getBoundingClientRect()
      if (!r) return
      const height = Math.min(240, options.length * 36 + 12)
      const below = window.innerHeight - r.bottom - 12
      const above = below < height && r.top > below
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        top: above ? Math.max(8, r.top - height - 6) : r.bottom + 6,
        width: r.width,
        maxHeight: Math.max(60, above ? Math.min(height, r.top - 14) : Math.min(height, below))
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent): void => {
      if (!trigger.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node))
        setOpen(false)
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [open])

  const choose = (index: number): void => {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="inpt ui-select"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          } else if (e.key === 'Tab') setOpen(false)
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            if (!open) show()
            else
              setActive(
                (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % (options.length || 1)
              )
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault()
            if (!open) setOpen(true)
            setActive(e.key === 'Home' ? 0 : options.length - 1)
          } else if ((e.key === 'Enter' || e.key === ' ') && open) {
            e.preventDefault()
            choose(active)
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const start = open ? active + 1 : selected + 1
            const match = options.findIndex((_, i) =>
              options[(start + i) % options.length]?.label
                .toLowerCase()
                .startsWith(e.key.toLowerCase())
            )
            if (match >= 0) {
              e.preventDefault()
              setActive((start + match) % options.length)
              setOpen(true)
            }
          }
        }}
      >
        <span>{options[selected]?.label ?? value}</span>
        <IconChevron small />
      </button>
      {open
        ? createPortal(
            <div
              ref={list}
              id={id}
              className="ui-select-list"
              role="listbox"
              aria-label={label}
              style={pos}
            >
              {options.map((option, i) => (
                <div
                  key={option.value}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={option.value === value}
                  data-active={i === active}
                  className="ui-select-option"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <IconCheck small /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
