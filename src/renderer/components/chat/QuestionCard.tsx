// claude's AskUserQuestion, answered in the chat one question at a time (#127): tabs by header,
// numbered options (keys 1…n), an "Other" answer of your own, Back / Next, and Answer (sent back
// as the tool's `answers`, all at once) or Skip.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentCli } from '@shared/agent-clis'
import type { ChatAnswers, ChatQuestion } from '@shared/chat'
import { nextQuestion, splitRecommended } from '../../lib/questions'
import { IconBack, IconCheck } from '../icons'
import { ProviderLogo } from '../ProviderLogo'

interface Pick {
  labels: string[]
  other: string
  /** The "Other…" row is picked: its text is the answer. */
  otherOn: boolean
}

const EMPTY: Pick = { labels: [], other: '', otherOn: false }
/** A pick on a one-choice question moves on after this, so the tick is seen first. */
const ADVANCE_MS = 350

/** The answer claude reads for one question: the labels (", " between), or the own text. */
export function answerOf(q: ChatQuestion, p: Pick): string {
  const parts = [...p.labels, ...(p.otherOn && p.other.trim() ? [p.other.trim()] : [])]
  return q.multiSelect ? parts.join(', ') : (parts[0] ?? '')
}

export function QuestionCard({
  questions,
  cli,
  onAnswer,
  onSkip
}: {
  questions: ChatQuestion[]
  /** The chat's CLI, for its logo beside "Claude asks". */
  cli: AgentCli | null
  onAnswer: (answers: ChatAnswers) => void
  onSkip: () => void
}) {
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => EMPTY))
  const [at, setAt] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answered = questions.map((q, i) => answerOf(q, picks[i]!) !== '')
  const ready = answered.every(Boolean)
  const q = questions[at]!
  const p = picks[at]!
  const last = at === questions.length - 1

  const go = (i: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setAt(Math.max(0, Math.min(questions.length - 1, i)))
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  // Each question starts with its picked row (or the first) focused, so keys work at once.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('.cq-opt.on, .cq-opt')?.focus()
  }, [at])

  const update = (i: number, fn: (p: Pick) => Pick): void =>
    setPicks((cur) => cur.map((c, j) => (j === i ? fn(c) : c)))
  const toggle = (i: number, label: string): void => {
    const multi = questions[i]!.multiSelect
    update(i, (c) =>
      multi
        ? {
            ...c,
            labels: c.labels.includes(label)
              ? c.labels.filter((l) => l !== label)
              : [...c.labels, label]
          }
        : { ...c, labels: [label], otherOn: false }
    )
    if (multi || i === questions.length - 1) return
    const after = answered.map((a, j) => (j === i ? true : a))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => go(nextQuestion(i, after)), ADVANCE_MS)
  }
  const submit = (): void => {
    if (!ready) return
    onAnswer(Object.fromEntries(questions.map((x, i) => [x.question, answerOf(x, picks[i]!)])))
  }
  const forward = (): void => {
    if (last) submit()
    else if (answered[at]) go(at + 1)
  }

  // 1…n pick, n+1 types Other, Enter goes on (Answer on the last), ← back, ↑↓ move, Esc skips.
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const typing = (e.target as HTMLElement).tagName === 'INPUT'
    const n = q.options.length
    let handled = true
    if (e.key === 'Escape') onSkip()
    else if (e.key === 'Enter') forward()
    else if (typing) handled = false
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n)
      toggle(at, q.options[Number(e.key) - 1]!.label)
    else if (e.key === String(n + 1))
      root.current?.querySelector<HTMLElement>('.cq-other input')?.focus()
    else if (e.key === 'ArrowLeft') go(at - 1)
    else if (e.key === 'ArrowRight' && answered[at]) go(at + 1)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [
        ...(root.current?.querySelectorAll<HTMLElement>('.cq-opt, .cq-other input') ?? [])
      ]
      const i = rows.indexOf(document.activeElement as HTMLElement)
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <div className="cq" role="dialog" aria-label="Claude asks" ref={root} onKeyDown={onKey}>
      <div className="cq-top">
        <span className="cq-who">
          {cli ? <ProviderLogo cli={cli} size={14} /> : null}
          Claude asks
        </span>
        {questions.length > 1 ? (
          <div className="cq-tabs" role="tablist" aria-label="Questions">
            {questions.map((x, i) => (
              <button
                key={x.question}
                type="button"
                role="tab"
                aria-selected={i === at}
                className={`cq-tab${i === at ? ' on' : answered[i] ? ' did' : ''}`}
                onClick={() => go(i)}
              >
                {answered[i] && i !== at ? <IconCheck small /> : null}
                {x.header || `Question ${i + 1}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="cq-item"
        key={at}
        role={q.multiSelect ? 'group' : 'radiogroup'}
        aria-label={q.question}
      >
        <div className="cq-n">
          {questions.length > 1 ? `${at + 1} of ${questions.length}` : (q.header ?? '')}
          {q.multiSelect ? ' · pick any' : ''}
        </div>
        <div className="cq-q">{q.question}</div>
        <div className="cq-opts">
          {q.options.map((o, k) => {
            const on = p.labels.includes(o.label)
            const { text, recommended } = splitRecommended(o.label)
            return (
              <button
                key={o.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={on}
                className={`cq-opt${on ? ' on' : ''}`}
                onClick={() => toggle(at, o.label)}
              >
                <kbd className="cq-k" aria-hidden="true">
                  {k + 1}
                </kbd>
                <span className="cq-txt">
                  <span className="cq-lb">
                    {text}
                    {recommended ? <span className="cq-rec">recommended</span> : null}
                  </span>
                  {o.description ? <span className="cq-ds">{o.description}</span> : null}
                </span>
                <span className="cq-tick">{on ? <IconCheck small /> : null}</span>
              </button>
            )
          })}
          <label className={`cq-other${p.otherOn ? ' on' : ''}`}>
            <kbd className="cq-k" aria-hidden="true">
              {q.options.length + 1}
            </kbd>
            <input
              className="inpt sans"
              placeholder="Other: type your own answer"
              maxLength={2000}
              value={p.other}
              aria-label={`Other answer: ${q.question}`}
              onFocus={() =>
                update(at, (c) => ({
                  ...c,
                  otherOn: true,
                  labels: q.multiSelect ? c.labels : []
                }))
              }
              onChange={(e) => update(at, (c) => ({ ...c, other: e.target.value, otherOn: true }))}
            />
          </label>
        </div>
      </div>
      <div className="cq-ft">
        <button type="button" className="btn gh" onClick={onSkip}>
          Skip
        </button>
        <span className="cq-keys" aria-hidden="true">
          <span>
            <kbd>1</kbd>–<kbd>{q.options.length + 1}</kbd> pick
          </span>
          <span>
            <kbd>Enter</kbd> {last ? 'answer' : 'next'}
          </span>
          {at > 0 ? (
            <span>
              <kbd className="cq-kic">
                <IconBack small />
              </kbd>{' '}
              back
            </span>
          ) : null}
        </span>
        {at > 0 ? (
          <button type="button" className="btn" onClick={() => go(at - 1)}>
            Back
          </button>
        ) : null}
        {last ? (
          <button type="button" className="btn pri" disabled={!ready} onClick={submit}>
            Answer
          </button>
        ) : (
          <button
            type="button"
            className="btn pri"
            disabled={!answered[at]}
            onClick={() => go(at + 1)}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
