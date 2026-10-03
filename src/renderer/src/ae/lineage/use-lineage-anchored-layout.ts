import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LineageLayoutResult } from './lineage-layout'

type Point = { x: number; y: number }
type SideCallback = (nodeId: string, side: 'up' | 'down') => void
type ExpandCallback = (nodeId: string, side: 'up' | 'down') => Promise<boolean>

/** The node a side button belongs to, where it sat, and the layout it sat in. */
export type LineageAnchorHold = { id: string; at: Point; layout: LineageLayoutResult }

const NO_OFFSET: Point = { x: 0, y: 0 }

/**
 * The layout offset that puts the held node back where it sat, given the new layout;
 * null when it would not move. A dragged node ignores the layout, so it never moves.
 */
export function lineageAnchorOffset(
  hold: LineageAnchorHold,
  placed: LineageLayoutResult,
  dragged: Record<string, Point>,
  offset: Point
): Point | null {
  const box = placed[hold.id]
  if (dragged[hold.id] || !box) {
    return null
  }
  const dx = hold.at.x - (box.x + offset.x)
  const dy = hold.at.y - (box.y + offset.y)
  return dx === 0 && dy === 0 ? null : { x: offset.x + dx, y: offset.y + dy }
}

export function shiftLineageLayout(
  placed: LineageLayoutResult,
  offset: Point
): LineageLayoutResult {
  if (offset.x === 0 && offset.y === 0) {
    return placed
  }
  return Object.fromEntries(
    Object.entries(placed).map(([id, box]) => [
      id,
      { ...box, x: box.x + offset.x, y: box.y + offset.y }
    ])
  )
}

/** Resolves with whether to hold the node: only an expansion that merged moved anything. */
export async function lineageExpansionMerged(merged: Promise<boolean>): Promise<boolean> {
  return merged.catch(() => false)
}

/**
 * Pod: keeps the node whose side button was clicked where it sits on screen. Hiding or
 * loading a side makes dagre shift every box, and the node slid out of view with its
 * own restore button. Rather than pan the viewport (which moves on its own clock and
 * ran frames ahead of the node tween), the whole layout is offset so that node keeps
 * its flow position; the tween then moves everything else around it.
 *
 * A hold is armed by the click, or by the answer for an expansion, and is consumed by
 * the next layout; one that no layout consumed lapses after two frames so an unrelated
 * later layout (depth, Arrange, columns) never shifts the canvas.
 */
export function useLineageAnchoredLayout(
  raw: LineageLayoutResult,
  dragged: Record<string, Point>,
  callbacks: { onToggleCollapse: SideCallback; onExpand: ExpandCallback }
): { placed: LineageLayoutResult; onToggleCollapse: SideCallback; onExpand: SideCallback } {
  const [offset, setOffset] = useState(NO_OFFSET)
  const [hold, setHold] = useState<LineageAnchorHold | null>(null)
  // Why during render: the shifted layout must reach the tween in the same pass, or
  // the node would start toward its unshifted spot.
  if (hold && hold.layout !== raw) {
    setHold(null)
    const next = lineageAnchorOffset(hold, raw, dragged, offset)
    if (next) {
      setOffset(next)
    }
  }
  const placed = useMemo(() => shiftLineageLayout(raw, offset), [raw, offset])
  const latest = useRef({ raw, placed, dragged })
  useEffect(() => {
    latest.current = { raw, placed, dragged }
  }, [raw, placed, dragged])
  const arm = useCallback((id: string) => {
    const current = latest.current
    const at = current.dragged[id] ?? current.placed[id]
    if (!at) {
      return
    }
    const next = { id, at: { x: at.x, y: at.y }, layout: current.raw }
    setHold(next)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setHold((held) => (held === next ? null : held)))
    )
  }, [])
  const { onToggleCollapse: toggle, onExpand: expand } = callbacks
  const onToggleCollapse = useCallback<SideCallback>(
    (nodeId, side) => {
      arm(nodeId)
      toggle(nodeId, side)
    },
    [arm, toggle]
  )
  const onExpand = useCallback<SideCallback>(
    (nodeId, side) =>
      void lineageExpansionMerged(expand(nodeId, side)).then((merged) => merged && arm(nodeId)),
    [arm, expand]
  )
  return { placed, onToggleCollapse, onExpand }
}
