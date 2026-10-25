// claude's AskUserQuestion, answered in the chat: its questions with their options, an "Other"
// answer of your own, then Answer (sent back as the tool's `answers`) or Skip.
import { useState, type KeyboardEvent } from 'react'
import type { ChatAnswers, ChatQuestion } from '@shared/chat'
import { IconCheck } from '../icons'

interface Pick {
  labels: string[]
  other: string
  /** The "Other…" row is picked: its text is the answer. */
  otherOn: boolean
}

const EMPTY: Pick = { labels: [], other: '', otherOn: false }

/** The answer claude reads for one question: the labels (", " between), or the own text. */
export function answerOf(q: ChatQuestion, p: Pick): string {
  const parts = [...p.labels, ...(p.otherOn && p.other.trim() ? [p.other.trim()] : [])]
  return q.multiSelect ? parts.join(', ') : (parts[0] ?? '')
}

export function QuestionCard({
  questions,
  onAnswer,
  onSkip
}: {
  questions: ChatQuestion[]
  onAnswer: (answers: ChatAnswers) => void
  onSkip: () => void
}) {
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => EMPTY))
  const ready = questions.every((q, i) => answerOf(q, picks[i]!) !== '')

  const update = (i: number, fn: (p: Pick) => Pick): void =>
    setPicks((cur) => cur.map((p, j) => (j === i ? fn(p) : p)))
  const toggle = (i: number, label: string): void =>
    update(i, (p) =>
      questions[i]!.multiSelect
        ? {
            ...p,
            labels: p.labels.includes(label)
              ? p.labels.filter((l) => l !== label)
              : [...p.labels, label]
          }
        : { ...p, labels: [label], otherOn: false }
    )
  const submit = (): void => {
    if (!ready) return
    onAnswer(Object.fromEntries(questions.map((q, i) => [q.question, answerOf(q, picks[i]!)])))
  }
  // ↑/↓ move between a question's rows; Space/Enter on a row picks it (buttons do that).
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.cq-opt, .cq-other input')]
    const at = rows.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    <div className="cq" role="dialog" aria-label="Claude asks">
      {questions.map((q, i) => {
        const p = picks[i]!
        return (
          <div
            key={q.question}
            className="cq-item"
            role={q.multiSelect ? 'group' : 'radiogroup'}
            aria-label={q.question}
            onKeyDown={onKey}
          >
            {q.header ? <div className="cq-hd">{q.header}</div> : null}
            <div className="cq-q">
              {q.question}
              {q.multiSelect ? <span className="cq-multi"> · pick any</span> : null}
            </div>
            <div className="cq-opts">
              {q.options.map((o, k) => {
                const on = p.labels.includes(o.label)
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    className={`cq-opt${on ? ' on' : ''}`}
                    autoFocus={i === 0 && k === 0}
                    onClick={() => toggle(i, o.label)}
                  >
                    <span className="cq-txt">
                      <span className="cq-lb">{o.label}</span>
                      {o.description ? <span className="cq-ds">{o.description}</span> : null}
                    </span>
                    {on ? <IconCheck small /> : null}
                  </button>
                )
              })}
              <label className={`cq-other${p.otherOn ? ' on' : ''}`}>
                <span className="cq-lb">Other</span>
                <input
                  className="inpt sans"
                  placeholder="Type your own answer"
                  maxLength={2000}
                  value={p.other}
                  aria-label={`Other answer: ${q.question}`}
                  onFocus={() =>
                    update(i, (c) => ({
                      ...c,
                      otherOn: true,
                      labels: q.multiSelect ? c.labels : []
                    }))
                  }
                  onChange={(e) =>
                    update(i, (c) => ({ ...c, other: e.target.value, otherOn: true }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submit()
                    }
                  }}
                />
              </label>
            </div>
          </div>
        )
      })}
      <div className="cq-ft">
        <button type="button" className="btn gh" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="btn pri" disabled={!ready} onClick={submit}>
          Answer
        </button>
      </div>
    </div>
  )
}
