import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'

/**
 * Pod: centres the canvas on the node picked in the upstream/downstream list. Every
 * click centres, the selected row included (`centreKey` changes per click), and a
 * selected node that was hidden behind a collapsed side is centred once it shows.
 * Other layout changes leave the view alone: they would fit on positions the tween
 * has not reached yet, and the side-button anchor owns those.
 */
export function useLineageCentreOnSelect(
  selectedNodeId: string | null,
  centreKey: number,
  visible: ReadonlySet<string>
): void {
  const { fitView } = useReactFlow()
  const last = useRef({ key: -1, shown: false })
  useEffect(() => {
    const shown = selectedNodeId !== null && visible.has(selectedNodeId)
    const previous = last.current
    last.current = { key: centreKey, shown }
    if (shown && (centreKey !== previous.key || !previous.shown)) {
      void fitView({ nodes: [{ id: selectedNodeId }], duration: 200, minZoom: 1, maxZoom: 1 })
    }
  }, [selectedNodeId, centreKey, visible, fitView])
}
