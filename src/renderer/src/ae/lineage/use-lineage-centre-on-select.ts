import { useEffect, useRef } from 'react'
import { useReactFlow, type FitViewOptions } from '@xyflow/react'

/**
 * Centres at 100 %, or zoomed out until the node fits: at a fixed 100 % a node wider than
 * a narrow canvas (the list open in a 1024 px window) put its side buttons out of reach.
 * The padding clears the side buttons, which hang 10 px past each edge.
 */
export function lineageCentreFitOptions(nodeId: string): FitViewOptions {
  return { nodes: [{ id: nodeId }], duration: 200, maxZoom: 1, padding: '24px' }
}

/**
 * Pod: centres the canvas on the node picked in the upstream/downstream list. Every
 * click centres, the selected row included (`centreKey` changes per click), and a
 * selected node that was hidden behind a collapsed side is centred once it shows,
 * unless a side button brought it back (`anchored`): re-centring then would pull the
 * clicked button out from under the pointer. Other layout changes leave the view alone.
 */
export function useLineageCentreOnSelect(
  selectedNodeId: string | null,
  centreKey: number,
  visible: ReadonlySet<string>,
  anchored: boolean
): void {
  const { fitView } = useReactFlow()
  const last = useRef({ key: -1, shown: false })
  useEffect(() => {
    const shown = selectedNodeId !== null && visible.has(selectedNodeId)
    const previous = last.current
    last.current = { key: centreKey, shown }
    if (shown && (centreKey !== previous.key || (!previous.shown && !anchored))) {
      void fitView(lineageCentreFitOptions(selectedNodeId))
    }
  }, [selectedNodeId, centreKey, visible, anchored, fitView])
}
