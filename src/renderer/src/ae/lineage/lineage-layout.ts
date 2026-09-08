import dagre from '@dagrejs/dagre'
import type { DbtGraphEdge } from '../../../../shared/ae/dbt-graph-types'

/**
 * Pod: node placement for the lineage canvas. Left to right, ranks from dagre's network
 * simplex so consumers of one model sit in the same column, ordered by its barycenter
 * pass so edges cross as little as it can manage.
 */
export const LINEAGE_NODE_WIDTH = 232
export const LINEAGE_HEADER_HEIGHT = 40
export const LINEAGE_COLUMN_ROW_HEIGHT = 20
export const LINEAGE_COLUMN_ROWS_MAX = 14
/** The "columns matched by name" footer: 2px margin, 1px border, one 16px line. */
export const LINEAGE_NAME_MATCHED_FOOTER_HEIGHT = 19
/**
 * Vertical gap between boxes in one column. Why 48: the footer a column click adds to
 * the nodes on its path is not part of the sizing (that would re-lay out the canvas on
 * every click), so the gap must swallow it with room to spare.
 */
export const LINEAGE_NODE_SEP = 48
const NODE_PADDING_BOTTOM = 6

export type LineageLayoutNode = {
  id: string
  columnCount: number
  showColumns: boolean
}

export type LineageLayoutResult = Record<
  string,
  { x: number; y: number; width: number; height: number }
>

/** Height the node component renders at, so dagre reserves the right space. */
export function lineageNodeHeight(columnCount: number, showColumns: boolean): number {
  if (!showColumns || columnCount === 0) {
    return LINEAGE_HEADER_HEIGHT
  }
  const rows =
    Math.min(columnCount, LINEAGE_COLUMN_ROWS_MAX) + (columnCount > LINEAGE_COLUMN_ROWS_MAX ? 1 : 0)
  return LINEAGE_HEADER_HEIGHT + rows * LINEAGE_COLUMN_ROW_HEIGHT + NODE_PADDING_BOTTOM
}

export function layoutLineage(
  nodes: LineageLayoutNode[],
  edges: DbtGraphEdge[]
): LineageLayoutResult {
  const graph = new dagre.graphlib.Graph()
  // Why network simplex: longest-path drags every sink into the last column, so two
  // consumers of one model land in different columns; this keeps each edge short.
  graph.setGraph({
    rankdir: 'LR',
    nodesep: LINEAGE_NODE_SEP,
    ranksep: 96,
    ranker: 'network-simplex'
  })
  graph.setDefaultEdgeLabel(() => ({}))
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of nodes) {
    const size = {
      width: LINEAGE_NODE_WIDTH,
      height: lineageNodeHeight(node.columnCount, node.showColumns)
    }
    sizes.set(node.id, size)
    // Why a copy: dagre writes its centre into the label it is given, and reading the
    // size back from that object later mixed the centre into the answer.
    graph.setNode(node.id, { ...size })
  }
  for (const edge of edges) {
    if (sizes.has(edge.source) && sizes.has(edge.target)) {
      graph.setEdge(edge.source, edge.target)
    }
  }
  dagre.layout(graph)
  const result: LineageLayoutResult = {}
  for (const node of nodes) {
    const placed = graph.node(node.id)
    const size = sizes.get(node.id) ?? { width: LINEAGE_NODE_WIDTH, height: LINEAGE_HEADER_HEIGHT }
    // Why subtract: dagre reports centres; React Flow positions the top-left corner.
    result[node.id] = {
      x: (placed?.x ?? 0) - size.width / 2,
      y: (placed?.y ?? 0) - size.height / 2,
      width: size.width,
      height: size.height
    }
  }
  return result
}

export type LineageViewport = {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

/**
 * Ids of placed nodes whose box lies within `margin` viewports of the visible area
 * (0 is the visible area itself, 1 adds one screen on every side), in layout order.
 * The canvas renders column rows only for these; the rest carry a same-height stand-in.
 */
export function lineageNodesNearViewport(
  placed: LineageLayoutResult,
  overrides: Record<string, { x: number; y: number }>,
  viewport: LineageViewport,
  margin: number
): string[] {
  const { x, y, zoom, width, height } = viewport
  if (!(zoom > 0) || !(width > 0) || !(height > 0)) {
    return []
  }
  // Why divide: React Flow's transform maps flow space to the screen as flow × zoom + offset.
  const w = width / zoom
  const h = height / zoom
  const left = -x / zoom - w * margin
  const top = -y / zoom - h * margin
  const right = left + w * (1 + 2 * margin)
  const bottom = top + h * (1 + 2 * margin)
  const ids: string[] = []
  for (const [id, box] of Object.entries(placed)) {
    const at = overrides[id] ?? box
    if (at.x + box.width >= left && at.x <= right && at.y + box.height >= top && at.y <= bottom) {
      ids.push(id)
    }
  }
  return ids
}
