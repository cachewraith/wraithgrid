import { memo, useMemo, useState, type ReactNode } from 'react'
import { useServices } from '../../app/services'
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown'
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

function InlineView({ nodes }: { nodes: Inline[] }) {
  const { api } = useServices()
  return (
    <>
      {nodes.map((n, i): ReactNode => {
        switch (n.t) {
          case 'text':
            return n.v
          case 'code':
            return <code key={i}>{n.v}</code>
          case 'b':
            return (
              <strong key={i}>
                <InlineView nodes={n.c} />
              </strong>
            )
          case 'i':
            return (
              <em key={i}>
                <InlineView nodes={n.c} />
              </em>
            )
          case 's':
            return (
              <s key={i}>
                <InlineView nodes={n.c} />
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
                <InlineView nodes={n.c} />
              </a>
            )
        }
      })}
    </>
  )
}

function CodeBlock({ lang, text, open }: { lang: string; text: string; open: boolean }) {
  return (
    <div className="md-code">
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

function BlockView({ b }: { b: Block }): ReactNode {
  switch (b.type) {
    case 'code':
      return <CodeBlock lang={b.lang} text={b.text} open={b.open} />
    case 'heading': {
      const Tag = `h${Math.min(b.level + 1, 6)}` as 'h2'
      return (
        <Tag>
          <InlineView nodes={b.c} />
        </Tag>
      )
    }
    case 'para':
      return (
        <p>
          <InlineView nodes={b.c} />
        </p>
      )
    case 'hr':
      return <hr />
    case 'quote':
      return (
        <blockquote>
          {b.blocks.map((x, i) => (
            <BlockView key={i} b={x} />
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
              <InlineView nodes={it.c} />
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
                    <InlineView nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, i) => (
                    <td key={i} style={{ textAlign: b.align[i] ?? undefined }}>
                      <InlineView nodes={c} />
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

/** Agent text as markdown; parsed again only when the text changes. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className="md">
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  )
})
