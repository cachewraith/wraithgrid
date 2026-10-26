import { describe, expect, it } from 'vitest'
import { onPanelDragEnd, panelDragging, setPanelDragging } from '../../src/renderer/lib/panel-drag'

describe('panel drag (#126)', () => {
  it('says while a drag runs and runs the waiting work once on release', () => {
    const calls: string[] = []
    const off = onPanelDragEnd(() => calls.push('fit'))
    expect(panelDragging()).toBe(false)
    setPanelDragging(true)
    setPanelDragging(true)
    expect(panelDragging()).toBe(true)
    expect(calls).toEqual([])
    setPanelDragging(false)
    setPanelDragging(false)
    expect(panelDragging()).toBe(false)
    expect(calls).toEqual(['fit'])
    // Unsubscribed (a pane closed): later drags leave it alone.
    off()
    setPanelDragging(true)
    setPanelDragging(false)
    expect(calls).toEqual(['fit'])
  })
})
