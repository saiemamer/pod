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
  graph.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 96, ranker: 'network-simplex' })
  graph.setDefaultEdgeLabel(() => ({}))
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of nodes) {
    const size = {
      width: LINEAGE_NODE_WIDTH,
      height: lineageNodeHeight(node.columnCount, node.showColumns)
    }
    sizes.set(node.id, size)
    graph.setNode(node.id, size)
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
      ...size
    }
  }
  return result
}
