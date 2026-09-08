import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@xyflow/react'
import { lineageNodesNearViewport, type LineageLayoutResult } from './lineage-layout'

/** Column rows render for nodes within this many screens of the viewport. */
export const ROWS_ENTER_MARGIN = 1
/** And stay rendered until the node is this many screens away. */
export const ROWS_KEEP_MARGIN = 2
/** Nodes whose rows are added per animation frame while catching up. */
export const ROWS_PER_FRAME = 3
const NO_IDS: string[] = []
const NO_SET: ReadonlySet<string> = new Set()

/**
 * Pod: which nodes carry rendered column rows. Rows are the bulk of a node's render, so
 * only nodes within a screen of the viewport get them; the rest carry a stand-in of
 * the same height. Nodes entering the margin fill in a few per frame, so a zoom-out
 * stays smooth, and leave it again two screens away, so a pan back costs nothing.
 */
export function useLineageRowsWindow(
  placed: LineageLayoutResult,
  overrides: Record<string, { x: number; y: number }>,
  columnsVisible: boolean
): ReadonlySet<string> {
  // Why keys: the selector runs on every pan frame; a string only changes when a node
  // crosses the margin, so React re-renders for that and not for the frame.
  const nearKey = useStore((state) =>
    columnsVisible
      ? lineageNodesNearViewport(
          placed,
          overrides,
          {
            x: state.transform[0],
            y: state.transform[1],
            zoom: state.transform[2],
            width: state.width,
            height: state.height
          },
          ROWS_ENTER_MARGIN
        ).join('|')
      : ''
  )
  const keepKey = useStore((state) =>
    lineageNodesNearViewport(
      placed,
      overrides,
      {
        x: state.transform[0],
        y: state.transform[1],
        zoom: state.transform[2],
        width: state.width,
        height: state.height
      },
      ROWS_KEEP_MARGIN
    ).join('|')
  )
  const near = useMemo(() => (nearKey ? nearKey.split('|') : NO_IDS), [nearKey])
  const keep = useMemo(() => new Set(keepKey ? keepKey.split('|') : NO_IDS), [keepKey])
  const [shown, setShown] = useState<ReadonlySet<string>>(NO_SET)
  useEffect(() => {
    const missing = near.filter((id) => !shown.has(id))
    const stale = [...shown].filter((id) => !keep.has(id))
    if (missing.length === 0 && stale.length === 0) {
      return
    }
    // Why a frame at a time: rows for forty nodes in one commit is a visible stall; each
    // step changes the state, which re-runs this effect for the next frame.
    const frame = requestAnimationFrame(() => {
      const next = new Set(shown)
      for (const id of stale) {
        next.delete(id)
      }
      for (const id of missing.slice(0, ROWS_PER_FRAME)) {
        next.add(id)
      }
      setShown(next)
    })
    return () => cancelAnimationFrame(frame)
  }, [near, keep, shown])
  return shown
}
