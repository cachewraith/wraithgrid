import { memo, useState, type ReactNode } from 'react'
import type { ApprovalDecision, ToolKind, ToolPreview } from '@shared/chat'
import type { ChatItem } from '../../lib/chat-thread'
import {
  IconCheck,
  IconChevron,
  IconClose,
  IconFile,
  IconGlobe,
  IconList,
  IconRename,
  IconSearch,
  IconSparkle,
  IconTerminal,
  IconTool
} from '../icons'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

const KIND_ICON: Record<ToolKind, (p: { small?: boolean }) => ReactNode> = {
  shell: IconTerminal,
  edit: IconRename,
  read: IconFile,
  search: IconSearch,
  web: IconGlobe,
  agent: IconSparkle,
  todo: IconList,
  other: IconTool
}

/** A tool's name as a verb phrase while it runs and once it has. */
const KIND_LABEL: Record<ToolKind, string> = {
  shell: 'Ran',
  edit: 'Edited',
  read: 'Read',
  search: 'Searched',
  web: 'Fetched',
  agent: 'Agent',
  todo: 'Tasks',
  other: ''
}

export function Preview({ preview }: { preview: ToolPreview }) {
  switch (preview.type) {
    case 'code':
      return <pre className="ct-code">{preview.text}</pre>
    case 'diff': {
      const del = preview.before ? preview.before.split('\n') : []
      const add = preview.after ? preview.after.split('\n') : []
      return (
        <pre className="ct-diff">
          {del.map((l, i) => (
            <div key={`d${i}`} className="del">
              <span>-</span>
              {l}
            </div>
          ))}
          {add.map((l, i) => (
            <div key={`a${i}`} className="add">
              <span>+</span>
              {l}
            </div>
          ))}
        </pre>
      )
    }
    case 'todos':
      return (
        <ul className="ct-todos">
          {preview.items.map((t, i) => (
            <li key={i} className={t.status}>
              <span className="md-box">{t.status === 'done' ? <IconCheck small /> : null}</span>
              {t.text}
            </li>
          ))}
        </ul>
      )
  }
}

/** One tool call: a line that opens to its input and output. */
export const ToolCard = memo(function ToolCard({
  item,
  live,
  cwd
}: {
  item: ToolItem
  /** The turn is still running, so a tool without output is still working. */
  live: boolean
  /** The pane's folder: paths inside it are shown relative. */
  cwd: string
}) {
  const [open, setOpen] = useState(item.toolKind === 'todo')
  const Icon = KIND_ICON[item.toolKind]
  const waiting = !!item.approval && item.approval.decided === null && live
  const denied = item.approval?.decided === 'deny'
  const state = waiting
    ? 'waiting'
    : denied
      ? 'denied'
      : item.output === null
        ? live
          ? 'running'
          : 'stopped'
        : item.isError
          ? 'error'
          : 'done'
  const subtitle =
    cwd && item.subtitle.startsWith(`${cwd}/`) ? item.subtitle.slice(cwd.length + 1) : item.subtitle
  const verb = KIND_LABEL[item.toolKind]
  const hasBody = !!item.preview || !!item.output
  return (
    <div className={`ct ct-${state}${open ? ' open' : ''}`}>
      <button
        className="ct-h"
        onClick={() => hasBody && setOpen(!open)}
        aria-expanded={hasBody ? open : undefined}
        disabled={!hasBody}
      >
        <span className="ct-ic">
          <Icon small />
        </span>
        <span className="ct-name">{verb && item.toolKind !== 'other' ? verb : item.name}</span>
        <span className="ct-sub" title={item.subtitle}>
          {subtitle}
        </span>
        <span className="ct-state" aria-label={state}>
          {state === 'running' ? <span className="ct-spin" /> : null}
          {state === 'done' ? <IconCheck small /> : null}
          {state === 'error' || state === 'denied' ? <IconClose small /> : null}
          {state === 'waiting' ? 'needs approval' : null}
          {state === 'stopped' ? 'stopped' : null}
          {state === 'denied' ? 'denied' : null}
        </span>
        {hasBody ? <IconChevron small className="ct-chev" /> : null}
      </button>
      <div className="ct-body">
        <div className="ct-inner">
          {item.preview ? <Preview preview={item.preview} /> : null}
          {item.output ? (
            <pre className={`ct-out${item.isError ? ' err' : ''}`}>{item.output}</pre>
          ) : null}
        </div>
      </div>
    </div>
  )
})

/** The question above the composer while the agent waits to run a tool. */
export function ApprovalBar({
  item,
  onDecide
}: {
  item: ToolItem
  onDecide: (decision: ApprovalDecision) => void
}) {
  const Icon = KIND_ICON[item.toolKind]
  return (
    <div className="ca" role="alertdialog" aria-label={`Allow ${item.name}?`}>
      <div className="ca-q">
        <span className="ca-ic">
          <Icon small />
        </span>
        <span>
          Allow <strong>{item.name}</strong>?
        </span>
        <span className="ca-sub" title={item.subtitle}>
          {item.subtitle}
        </span>
      </div>
      {item.preview && item.preview.type !== 'todos' ? (
        <div className="ca-preview">
          <Preview preview={item.preview} />
        </div>
      ) : null}
      <div className="ca-btns">
        <button className="btn gh" onClick={() => onDecide('deny')}>
          Deny
        </button>
        {item.approval?.canAlways ? (
          <button
            className="btn"
            title="Allow, and remember it the way the agent suggests (e.g. accept edits for this session)"
            onClick={() => onDecide('always')}
          >
            Always allow
          </button>
        ) : null}
        <button className="btn pri" onClick={() => onDecide('allow')}>
          Allow
        </button>
      </div>
    </div>
  )
}
