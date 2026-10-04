import type { LineageLayoutResult } from './lineage-layout'

/**
 * The lowest zoom a lineage opens at. Why 0.6: above the column cut (0.55), so the
 * first view still lists columns, and header text stays readable on a large graph.
 */
export const LINEAGE_OPEN_ZOOM_MIN = 0.6
const OPEN_PADDING = 24

export type LineageOpenViewport = { x: number; y: number; zoom: number }

/**
 * Pod: the viewport a lineage opens at. The whole graph fitted into the panel, never
 * above 100 % or below the floor, centred on the focus model; on an axis where the
 * graph fits, the view slides toward the focus only as far as keeps the graph in view.
 * Null until the panel has a size.
 */
export function lineageOpenViewport(
  placed: LineageLayoutResult,
  focusId: string,
  panel: { width: number; height: number }
): LineageOpenViewport | null {
  const focus = placed[focusId]
  if (!focus || !(panel.width > 0) || !(panel.height > 0)) {
    return null
  }
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const box of Object.values(placed)) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width)
    bottom = Math.max(bottom, box.y + box.height)
  }
  const fit = Math.min(
    (panel.width - 2 * OPEN_PADDING) / (right - left),
    (panel.height - 2 * OPEN_PADDING) / (bottom - top)
  )
  const zoom = Math.min(1, Math.max(LINEAGE_OPEN_ZOOM_MIN, fit))
  // Why per axis: React Flow maps flow space to the screen as flow × zoom + offset.
  const axis = (size: number, centre: number, min: number, max: number): number => {
    const centred = size / 2 - centre * zoom
    if ((max - min) * zoom > size - 2 * OPEN_PADDING) {
      return centred
    }
    const lowest = size - OPEN_PADDING - max * zoom
    const highest = OPEN_PADDING - min * zoom
    return Math.min(highest, Math.max(lowest, centred))
  }
  return {
    x: axis(panel.width, focus.x + focus.width / 2, left, right),
    y: axis(panel.height, focus.y + focus.height / 2, top, bottom),
    zoom
  }
}
