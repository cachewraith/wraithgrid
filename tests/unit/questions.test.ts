import { describe, expect, it } from 'vitest'
import { nextQuestion, splitRecommended } from '../../src/renderer/lib/questions'

describe("Claude's questions, one at a time (#127)", () => {
  it('shows "(Recommended)" as a tag, not part of the label', () => {
    expect(splitRecommended('Callback + sweep (Recommended)')).toEqual({
      text: 'Callback + sweep',
      recommended: true
    })
    expect(splitRecommended('Don’t approve, alert (recommended) ')).toEqual({
      text: 'Don’t approve, alert',
      recommended: true
    })
    expect(splitRecommended('Callback only')).toEqual({ text: 'Callback only', recommended: false })
    // Only at the end, and never an empty label.
    expect(splitRecommended('(Recommended) first')).toEqual({
      text: '(Recommended) first',
      recommended: false
    })
    expect(splitRecommended('(Recommended)')).toEqual({ text: '(Recommended)', recommended: false })
  })

  it('moves on to the next unanswered question', () => {
    expect(nextQuestion(0, [true, false, false])).toBe(1)
    expect(nextQuestion(0, [true, true, false])).toBe(2)
    // All after it answered: just the next one; at the end it stays.
    expect(nextQuestion(0, [true, true, true])).toBe(1)
    expect(nextQuestion(2, [true, true, true])).toBe(2)
  })
})
