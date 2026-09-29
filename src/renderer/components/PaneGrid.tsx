import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels'
import { useShallow } from 'zustand/react/shallow'
import type { LayoutNode } from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { DENSE_PANE_COUNT, activeWorkspace } from '../app/store'
import type { Rect } from '../layout/focus'
import { leafKey, shapeKey, type Path } from '../layout/tree'
import { EmptyState } from './EmptyState'
import { IconPlus } from './icons'
import { Pane } from './Pane'

const GRID_PAD = 6

function childId(node: LayoutNode, path: Path, i: number): string {
  return node.type === 'split' ? `s${[...path, i].join('-')}` : leafKey(node)
}

/** The split tree, rendered with resizable panels. Pane leaves are empty anchors. */
function LayoutView({ node, path }: { node: LayoutNode; path: Path }) {
  const actions = useActions()
  if (node.type === 'pane') return <div className="slot-anchor" data-slot-pane={node.paneId} />
  if (node.type === 'empty') {
    return (
      <button
        className="slot"
        onClick={() => actions.openModal({ kind: 'newPane', slotId: node.slotId })}
      >
        <IconPlus />
        New pane here
      </button>
    )
  }
  const ids = node.children.map((c, i) => childId(c, path, i))
  const defaultLayout: Layout = Object.fromEntries(
    ids.map((id, i) => [id, node.sizes[i] ?? 100 / ids.length])
  )
  return (
    <Group
      // Remount on shape changes so the new tree's sizes apply; terminals live elsewhere.
      key={shapeKey(node)}
      className="grid-group"
      orientation={node.dir === 'row' ? 'horizontal' : 'vertical'}
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return
        const applied = meta.requestedLayout ?? layout
        actions.setSplitSizes(
          path,
          ids.map((id) => applied[id] ?? 0)
        )
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={ids[i]}>
          {i > 0 ? <Separator className="sep" /> : null}
          <Panel id={ids[i]} minSize={node.dir === 'row' ? 180 : 110}>
            <LayoutView node={child} path={[...path, i]} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  )
}

const sameRects = (a: Record<string, Rect>, b: Record<string, Rect>): boolean => {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => {
    const x = a[k]!
    const y = b[k]
    return (
      !!y &&
      Math.abs(x.left - y.left) < 0.5 &&
      Math.abs(x.top - y.top) < 0.5 &&
      Math.abs(x.width - y.width) < 0.5 &&
      Math.abs(x.height - y.height) < 0.5
    )
  })
}

/** Measures every pane anchor relative to the grid, on layout changes and resizes. */
function useAnchorRects(containerRef: React.RefObject<HTMLDivElement | null>, shape: string) {
  const [rects, setRects] = useState<Record<string, Rect>>({})
  const [box, setBox] = useState({ width: 0, height: 0 })

  const measure = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    const base = c.getBoundingClientRect()
    const next: Record<string, Rect> = {}
    c.querySelectorAll<HTMLElement>('[data-slot-pane]').forEach((el) => {
      const r = el.getBoundingClientRect()
      next[el.dataset.slotPane!] = {
        left: r.left - base.left,
        top: r.top - base.top,
        width: r.width,
        height: r.height
      }
    })
    setRects((prev) => (sameRects(prev, next) ? prev : next))
    setBox((prev) =>
      prev.width === base.width && prev.height === base.height
        ? prev
        : { width: base.width, height: base.height }
    )
  }, [containerRef])

  useLayoutEffect(measure, [measure, shape])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(c)
    c.querySelectorAll('[data-slot-pane]').forEach((el) => ro.observe(el))
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [containerRef, measure, shape])

  return { rects, box }
}

export function PaneGrid() {
  const { rects: registry } = useServices()
  const actions = useActions()
  const ws = useApp(activeWorkspace)
  const zoomedPaneId = useApp((s) => s.zoomedPaneId)
  const view = useApp((s) => s.view)
  // Panes of every workspace opened this session stay mounted, so their sessions live on.
  const mountedIds = useApp(
    useShallow((s) =>
      s.config.workspaces
        .filter((w) => w.id === s.config.activeWorkspace || s.activated[w.id])
        .flatMap((w) => w.panes.map((p) => p.id))
    )
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const shape = ws.layout ? shapeKey(ws.layout) : 'none'
  const { rects, box } = useAnchorRects(containerRef, `${ws.id}:${shape}:${zoomedPaneId ?? ''}`)

  const activeIds = useMemo(() => new Set(ws.panes.map((p) => p.id)), [ws.panes])
  const zoomed = zoomedPaneId && activeIds.has(zoomedPaneId) ? zoomedPaneId : null

  const visibleRects = useMemo(() => {
    const out: Record<string, Rect> = {}
    if (zoomed) {
      out[zoomed] = {
        left: GRID_PAD,
        top: GRID_PAD,
        width: Math.max(0, box.width - GRID_PAD * 2),
        height: Math.max(0, box.height - GRID_PAD * 2)
      }
      return out
    }
    for (const [id, r] of Object.entries(rects)) if (activeIds.has(id)) out[id] = r
    return out
  }, [zoomed, rects, box, activeIds])

  useEffect(() => registry.set(visibleRects), [registry, visibleRects])

  const dense = !zoomed && Object.keys(visibleRects).length >= DENSE_PANE_COUNT
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const onDragEnd = (e: DragEndEvent): void => {
    if (e.over && e.over.id !== e.active.id) actions.swap(String(e.active.id), String(e.over.id))
  }

  return (
    <div
      className="grid-root"
      ref={containerRef}
      style={view === 'grid' ? undefined : { visibility: 'hidden' }}
    >
      {ws.layout ? (
        <div className="grid" style={zoomed ? { visibility: 'hidden' } : undefined}>
          <LayoutView node={ws.layout} path={[]} />
        </div>
      ) : (
        <EmptyState />
      )}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <div className="pane-layer">
          {mountedIds.map((id) => (
            <Pane
              key={id}
              paneId={id}
              rect={visibleRects[id] ?? null}
              dense={dense}
              zoomed={zoomed === id}
              dragDisabled={!!zoomed || view !== 'grid'}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
