import { useEffect, useMemo, useState } from 'react'
import { lineageNodesNearViewport, type LineageLayoutResult } from './lineage-layout'

/** Flow-space window around the focus that mounts first, before the rest of the graph. */
const FIRST_MOUNT_WIDTH = 1400
const FIRST_MOUNT_HEIGHT = 1000
/** Nodes admitted per animation frame once the canvas shows, nearest to the focus first. */
const TAIL_PER_FRAME = 16

/**
 * Pod: which nodes the canvas mounts on its first open. A hundred nodes in one commit
 * is the longest task of the whole view, and the fit only needs the focus measured:
 * the nodes around the focus mount first, the canvas shows, and the rest stream in a
 * few per frame, nearest first and off screen by then. Returns null once everything
 * may mount, and stays null after that.
 */
export function useLineageFirstMount(
  placed: LineageLayoutResult,
  focusId: string,
  ready: boolean
): ReadonlySet<string> | null {
  const [admitted, setAdmitted] = useState(0)
  const order = useMemo(() => {
    const focus = placed[focusId]
    if (!focus) {
      return null
    }
    const centreX = focus.x + focus.width / 2
    const centreY = focus.y + focus.height / 2
    const near = new Set(
      lineageNodesNearViewport(
        placed,
        {},
        {
          x: FIRST_MOUNT_WIDTH / 2 - centreX,
          y: FIRST_MOUNT_HEIGHT / 2 - centreY,
          zoom: 1,
          width: FIRST_MOUNT_WIDTH,
          height: FIRST_MOUNT_HEIGHT
        },
        0
      )
    )
    const rest = Object.entries(placed)
      .filter(([id]) => !near.has(id))
      .map(([id, box]) => ({
        id,
        distance: Math.hypot(box.x + box.width / 2 - centreX, box.y + box.height / 2 - centreY)
      }))
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.id)
    return { near: [...near], rest }
  }, [placed, focusId])
  const total = order?.rest.length ?? 0
  useEffect(() => {
    if (!ready || !order || admitted >= total) {
      return
    }
    // Why Infinity at the end: a later, larger graph (a depth change, an expansion)
    // mounts whole; staging is for the first open only.
    const frame = requestAnimationFrame(() =>
      setAdmitted((count) => (count + TAIL_PER_FRAME >= total ? Infinity : count + TAIL_PER_FRAME))
    )
    return () => cancelAnimationFrame(frame)
  }, [ready, order, admitted, total])
  return useMemo(() => {
    if (!order || admitted >= total) {
      return null
    }
    return new Set([...order.near, ...order.rest.slice(0, admitted)])
  }, [order, admitted, total])
}
