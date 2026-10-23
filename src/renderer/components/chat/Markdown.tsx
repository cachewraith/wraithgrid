import {
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { useServices } from '../../app/services'
import {
  isDiagram,
  parseMarkdown,
  settledLength,
  type Block,
  type Inline
} from '../../lib/markdown'
import { IconCheck, IconCopy } from '../icons'

/** Copies `text`; the button shows a tick for a moment. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className={`md-copy${done ? ' done' : ''}`}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      {done ? <IconCheck small /> : <IconCopy small />}
    </button>
  )
}

/** Text split after each run of spaces: "a b " → ["a ", "b "]. */
const WORDS = /\S*\s*/g

/**
 * `fresh` = the streaming tail (#62): each word is its own span that fades in once, when it
 * first appears. Keyed by position, so words already shown keep their span and don't fade again.
 */
function InlineView({ nodes, fresh = false }: { nodes: Inline[]; fresh?: boolean }) {
  const { api } = useServices()
  return (
    <>
      {nodes.map((n, i): ReactNode => {
        switch (n.t) {
          case 'text':
            return fresh ? (
              <Fragment key={i}>
                {(n.v.match(WORDS) ?? []).map((w, j) =>
                  w ? (
                    <span key={j} className="md-w">
                      {w}
                    </span>
                  ) : null
                )}
              </Fragment>
            ) : (
              n.v
            )
          case 'code':
            return <code key={i}>{n.v}</code>
          case 'b':
            return (
              <strong key={i}>
                <InlineView nodes={n.c} fresh={fresh} />
              </strong>
            )
          case 'i':
            return (
              <em key={i}>
                <InlineView nodes={n.c} fresh={fresh} />
              </em>
            )
          case 's':
            return (
              <s key={i}>
                <InlineView nodes={n.c} fresh={fresh} />
              </s>
            )
          case 'a':
            return (
              <a
                key={i}
                href={n.href}
                title={n.href}
                onClick={(e) => {
                  e.preventDefault()
                  void api.shell.openExternal(n.href)
                }}
              >
                <InlineView nodes={n.c} fresh={fresh} />
              </a>
            )
        }
      })}
    </>
  )
}

function CodeBlock({
  lang,
  text,
  open,
  className
}: {
  lang: string
  text: string
  open: boolean
  className?: string
}) {
  return (
    <div
      className={`md-code${isDiagram(text) ? ' diagram' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="md-code-h">
        <span>{lang || 'text'}</span>
        {open ? null : <CopyButton text={text} label="Copy code" />}
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function BlockView({ b, fresh = false }: { b: Block; fresh?: boolean }): ReactNode {
  switch (b.type) {
    case 'code':
      return <CodeBlock lang={b.lang} text={b.text} open={b.open} />
    case 'heading': {
      const Tag = `h${Math.min(b.level + 1, 6)}` as 'h2'
      return (
        <Tag>
          <InlineView nodes={b.c} fresh={fresh} />
        </Tag>
      )
    }
    case 'para':
      return (
        <p>
          <InlineView nodes={b.c} fresh={fresh} />
        </p>
      )
    case 'hr':
      return <hr />
    case 'quote':
      return (
        <blockquote>
          {b.blocks.map((x, i) => (
            <BlockView key={i} b={x} fresh={fresh} />
          ))}
        </blockquote>
      )
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag start={b.ordered && b.start !== 1 ? b.start : undefined}>
          {b.items.map((it, i) => (
            <li
              key={i}
              className={it.task === null ? undefined : `task${it.task ? ' done' : ''}`}
              style={it.depth ? { marginLeft: it.depth * 18 } : undefined}
            >
              {it.task === null ? null : (
                <span className="md-box" aria-label={it.task ? 'done' : 'to do'}>
                  {it.task ? <IconCheck small /> : null}
                </span>
              )}
              <InlineView nodes={it.c} fresh={fresh} />
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="md-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={{ textAlign: b.align[i] ?? undefined }}>
                    <InlineView nodes={c} fresh={fresh} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, i) => (
                    <td key={i} style={{ textAlign: b.align[i] ?? undefined }}>
                      <InlineView nodes={c} fresh={fresh} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/**
 * Blocks of one stretch of text, parsed again only when that stretch changes. `fresh` blocks
 * (the streaming tail) ease in as they appear and fade their words in.
 */
const Blocks = memo(function Blocks({ text, fresh = false }: { text: string; fresh?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return blocks.map((b, i) => (fresh ? <FreshBlock key={i} b={b} /> : <BlockView key={i} b={b} />))
})

/** A tail block with the `md-in` class on its own element (no wrapper: `.md > *` stays). */
function FreshBlock({ b }: { b: Block }): ReactNode {
  const el = BlockView({ b, fresh: true })
  if (!isValidElement<{ className?: string }>(el)) return el
  const cls = [el.props.className, 'md-in'].filter(Boolean).join(' ')
  return cloneElement(el as ReactElement<{ className?: string }>, { className: cls })
}

/**
 * Agent text as markdown. While it grows, only the part after its last finished block is
 * parsed and drawn again (#52); the finished part stays as it was.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming = false
}: {
  text: string
  streaming?: boolean
}) {
  const cut = settledLength(text)
  return (
    <div className="md">
      <Blocks key="done" text={text.slice(0, cut)} />
      {/* Keyed by where it starts, so a new block's words are new spans that fade in. */}
      <Blocks key={`tail${cut}`} text={text.slice(cut)} fresh={streaming} />
    </div>
  )
})
