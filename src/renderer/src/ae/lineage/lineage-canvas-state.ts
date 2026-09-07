import type {
  DbtColumnLineageEdge,
  DbtColumnLineageResult,
  DbtGraphEdge,
  DbtGraphNode,
  DbtGraphResult
} from '../../../../shared/ae/dbt-graph-types'
import { dbtColumnKey } from '../../../../shared/ae/dbt-lineage-graph'

/**
 * Pod: what the canvas shows, derived from the graph the main process sent plus local
 * choices (collapsed handles, the focused column). Pure, so it is tested without
 * React Flow.
 */
export type LineageCollapse = { up: Set<string>; down: Set<string> }

export const EMPTY_COLLAPSE: LineageCollapse = { up: new Set(), down: new Set() }

/**
 * Nodes still reachable from the focus when collapsed handles block traversal past a
 * node in that direction. Anything unreachable is hidden with its edges.
 */
export function visibleLineageNodeIds(
  graph: DbtGraphResult,
  collapse: LineageCollapse
): Set<string> {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const edge of graph.edges) {
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target])
  }
  const visible = new Set<string>([graph.focus])
  const walk = (start: string, direction: 'up' | 'down'): void => {
    const frontier = [start]
    while (frontier.length > 0) {
      const id = frontier.pop() as string
      if (collapse[direction].has(id)) {
        continue
      }
      const next = direction === 'up' ? parents.get(id) : children.get(id)
      for (const neighbour of next ?? []) {
        if (!visible.has(neighbour)) {
          visible.add(neighbour)
          frontier.push(neighbour)
        }
      }
    }
  }
  walk(graph.focus, 'up')
  walk(graph.focus, 'down')
  return visible
}

/** Neighbours a node has on one side, counted from the visible graph. */
export function lineageSideCounts(
  graph: DbtGraphResult,
  visible: Set<string>
): Record<string, { up: number; down: number }> {
  const counts: Record<string, { up: number; down: number }> = {}
  for (const id of visible) {
    counts[id] = { up: 0, down: 0 }
  }
  for (const edge of graph.edges) {
    if (visible.has(edge.source) && visible.has(edge.target)) {
      counts[edge.target].up += 1
      counts[edge.source].down += 1
    }
  }
  return counts
}

export function mergeLineageGraphs(base: DbtGraphResult, extra: DbtGraphResult): DbtGraphResult {
  const nodes = new Map(base.nodes.map((node) => [node.uniqueId, node]))
  for (const node of extra.nodes) {
    nodes.set(node.uniqueId, node)
  }
  const edgeKey = (edge: DbtGraphEdge): string => `${edge.source}->${edge.target}`
  const edges = new Map(base.edges.map((edge) => [edgeKey(edge), edge]))
  for (const edge of extra.edges) {
    edges.set(edgeKey(edge), edge)
  }
  // Why replace per node: the expanded node's "more" counts are now known exactly.
  const moreUpstream = { ...base.moreUpstream }
  const moreDownstream = { ...base.moreDownstream }
  for (const id of Object.keys(extra.moreUpstream)) {
    moreUpstream[id] = extra.moreUpstream[id]
  }
  for (const id of Object.keys(extra.moreDownstream)) {
    moreDownstream[id] = extra.moreDownstream[id]
  }
  delete moreUpstream[extra.focus]
  delete moreDownstream[extra.focus]
  if (extra.moreUpstream[extra.focus]) {
    moreUpstream[extra.focus] = extra.moreUpstream[extra.focus]
  }
  if (extra.moreDownstream[extra.focus]) {
    moreDownstream[extra.focus] = extra.moreDownstream[extra.focus]
  }
  return {
    ...base,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    moreUpstream,
    moreDownstream,
    truncated: base.truncated || extra.truncated
  }
}

export type LineageHighlight = {
  /** dbtColumnKey of every column on the path, focus included. */
  columns: Set<string>
  nodes: Set<string>
  edges: DbtColumnLineageEdge[]
}

export function lineageHighlightFrom(
  result: DbtColumnLineageResult | null
): LineageHighlight | null {
  if (!result) {
    return null
  }
  const columns = new Set(result.columns.map(dbtColumnKey))
  return {
    columns,
    nodes: new Set(result.columns.map((column) => column.uniqueId)),
    edges: [...result.upstream, ...result.downstream]
  }
}

/** Column names (as the node spells them) that are lit on one node. */
export function highlightedColumnNames(
  node: DbtGraphNode,
  highlight: LineageHighlight | null
): string[] {
  if (!highlight) {
    return []
  }
  return node.columns
    .filter((column) =>
      highlight.columns.has(dbtColumnKey({ uniqueId: node.uniqueId, column: column.name }))
    )
    .map((column) => column.name)
}

export const LINEAGE_COLUMN_ZOOM_MIN = 0.55

export function lineageColumnsVisible(showColumns: boolean, zoom: number): boolean {
  return showColumns && zoom >= LINEAGE_COLUMN_ZOOM_MIN
}
