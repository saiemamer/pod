import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'

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
      void fitView({ nodes: [{ id: selectedNodeId }], duration: 200, minZoom: 1, maxZoom: 1 })
    }
  }, [selectedNodeId, centreKey, visible, anchored, fitView])
}
