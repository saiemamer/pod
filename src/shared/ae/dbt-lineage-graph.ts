import {
  DBT_COLUMN_INHERIT_MAX_PASSES,
  DBT_COLUMN_LINEAGE_MAX_PASSES,
  type DbtColumnLineageEdge,
  type DbtColumnRef,
  type DbtGraphEdge,
  type DbtGraphNode
} from './dbt-graph-types'

/**
 * Pod: graph walks shared by the main process (neighbourhood, column inheritance,
 * column propagation) and the renderer (expanding the canvas locally). Pure functions
 * over plain maps; nothing here reads a file.
 */
export type DbtGraphIndex = {
  nodes: Map<string, DbtGraphNode>
  parents: Map<string, string[]>
  children: Map<string, string[]>
}

export function indexDbtGraph(nodes: Iterable<DbtGraphNode>, edges: DbtGraphEdge[]): DbtGraphIndex {
  const index: DbtGraphIndex = {
    nodes: new Map(),
    parents: new Map(),
    children: new Map()
  }
  for (const node of nodes) {
    index.nodes.set(node.uniqueId, node)
  }
  for (const edge of edges) {
    if (!index.nodes.has(edge.source) || !index.nodes.has(edge.target)) {
      continue
    }
    push(index.parents, edge.target, edge.source)
    push(index.children, edge.source, edge.target)
  }
  return index
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (!list) {
    map.set(key, [value])
  } else if (!list.includes(value)) {
    list.push(value)
  }
}

export type DbtNeighbourhoodOptions = {
  upstreamDepth: number
  downstreamDepth: number
  maxNodes: number
}

export type DbtNeighbourhood = {
  nodeIds: string[]
  edges: DbtGraphEdge[]
  moreUpstream: Record<string, number>
  moreDownstream: Record<string, number>
  truncated: boolean
}

/**
 * Breadth-first in both directions from the focus, one depth level at a time and
 * alternating sides, so a cap leaves both parents and children represented. Nodes
 * whose neighbours were left out get a count, which the canvas turns into a handle.
 */
export function selectDbtNeighbourhood(
  index: DbtGraphIndex,
  focus: string,
  options: DbtNeighbourhoodOptions
): DbtNeighbourhood {
  const selected = new Set<string>([focus])
  const moreUpstream: Record<string, number> = {}
  const moreDownstream: Record<string, number> = {}
  let truncated = false
  let upFrontier = [focus]
  let downFrontier = [focus]
  const maxDepth = Math.max(options.upstreamDepth, options.downstreamDepth)
  type Candidate = { id: string; via: string }
  const gather = (
    frontier: string[],
    edges: Map<string, string[]>,
    more: Record<string, number>,
    allowed: boolean
  ): Candidate[] => {
    const candidates: Candidate[] = []
    for (const id of frontier) {
      const neighbours = (edges.get(id) ?? []).filter((n) => !selected.has(n))
      if (!allowed) {
        if (neighbours.length > 0) {
          more[id] = neighbours.length
        }
        continue
      }
      for (const neighbour of neighbours) {
        candidates.push({ id: neighbour, via: id })
      }
    }
    return candidates
  }
  // Why interleave: with a cap, taking all parents first would leave no room for
  // children; alternating keeps both sides of the focus on the canvas.
  const admit = (
    ups: Candidate[],
    downs: Candidate[],
    moreUp: Record<string, number>,
    moreDown: Record<string, number>
  ): { up: string[]; down: string[] } => {
    const up: string[] = []
    const down: string[] = []
    const queues: [Candidate[], string[], Record<string, number>][] = [
      [ups, up, moreUp],
      [downs, down, moreDown]
    ]
    let progressed = true
    while (progressed) {
      progressed = false
      for (const [queue, out, more] of queues) {
        const candidate = queue.shift()
        if (!candidate) {
          continue
        }
        progressed = true
        if (selected.has(candidate.id)) {
          continue
        }
        if (selected.size >= options.maxNodes) {
          truncated = true
          more[candidate.via] = (more[candidate.via] ?? 0) + 1
          continue
        }
        selected.add(candidate.id)
        out.push(candidate.id)
      }
    }
    return { up, down }
  }
  for (let depth = 1; depth <= maxDepth + 1; depth += 1) {
    const ups = gather(upFrontier, index.parents, moreUpstream, depth <= options.upstreamDepth)
    const downs = gather(
      downFrontier,
      index.children,
      moreDownstream,
      depth <= options.downstreamDepth
    )
    const admitted = admit(ups, downs, moreUpstream, moreDownstream)
    upFrontier = admitted.up
    downFrontier = admitted.down
    if (upFrontier.length === 0 && downFrontier.length === 0) {
      break
    }
  }
  const edges: DbtGraphEdge[] = []
  for (const id of selected) {
    for (const parent of index.parents.get(id) ?? []) {
      if (selected.has(parent)) {
        edges.push({ source: parent, target: id })
      }
    }
  }
  return {
    nodeIds: [...selected],
    edges,
    moreUpstream,
    moreDownstream,
    truncated
  }
}

/**
 * Nodes with no column list take the union of their parents' columns, repeated until
 * nothing changes or the pass cap is hit, so a chain of `select *` models still shows
 * columns. Marks them as inherited.
 */
export function inheritDbtColumns(
  index: DbtGraphIndex,
  maxPasses = DBT_COLUMN_INHERIT_MAX_PASSES
): number {
  let filled = 0
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false
    for (const node of index.nodes.values()) {
      if (node.columns.length > 0) {
        continue
      }
      const seen = new Set<string>()
      const columns: DbtGraphNode['columns'] = []
      for (const parentId of index.parents.get(node.uniqueId) ?? []) {
        for (const column of index.nodes.get(parentId)?.columns ?? []) {
          const key = column.name.toLowerCase()
          if (!seen.has(key)) {
            seen.add(key)
            columns.push({
              name: column.name,
              dataType: column.dataType,
              source: 'inherited'
            })
          }
        }
      }
      if (columns.length > 0) {
        node.columns = columns
        node.columnSource = 'inherited'
        changed = true
        filled += 1
      }
    }
    if (!changed) {
      break
    }
  }
  return filled
}

export function dbtColumnKey(ref: DbtColumnRef): string {
  return `${ref.uniqueId}#${ref.column.toLowerCase()}`
}

export type DbtColumnEdgeIndex = {
  upstreamOf: (ref: DbtColumnRef) => DbtColumnLineageEdge[]
  downstreamOf: (ref: DbtColumnRef) => DbtColumnLineageEdge[]
}

export function indexDbtColumnEdges(edges: DbtColumnLineageEdge[]): DbtColumnEdgeIndex {
  const up = new Map<string, DbtColumnLineageEdge[]>()
  const down = new Map<string, DbtColumnLineageEdge[]>()
  for (const edge of edges) {
    const toKey = dbtColumnKey(edge.to)
    const fromKey = dbtColumnKey(edge.from)
    up.set(toKey, [...(up.get(toKey) ?? []), edge])
    down.set(fromKey, [...(down.get(fromKey) ?? []), edge])
  }
  return {
    upstreamOf: (ref) => up.get(dbtColumnKey(ref)) ?? [],
    downstreamOf: (ref) => down.get(dbtColumnKey(ref)) ?? []
  }
}

export type DbtColumnPropagation = {
  columns: DbtColumnRef[]
  upstream: DbtColumnLineageEdge[]
  downstream: DbtColumnLineageEdge[]
  truncated: boolean
}

/** Follows column edges away from the focus in both directions, one hop per pass. */
export function propagateDbtColumnLineage(
  focus: DbtColumnRef,
  index: DbtColumnEdgeIndex,
  maxPasses = DBT_COLUMN_LINEAGE_MAX_PASSES
): DbtColumnPropagation {
  const columns = new Map<string, DbtColumnRef>([[dbtColumnKey(focus), focus]])
  const walk = (
    direction: 'upstream' | 'downstream'
  ): { edges: DbtColumnLineageEdge[]; truncated: boolean } => {
    const edges: DbtColumnLineageEdge[] = []
    const seenEdges = new Set<string>()
    let frontier = [focus]
    let passes = 0
    while (frontier.length > 0) {
      if (passes >= maxPasses) {
        return { edges, truncated: true }
      }
      passes += 1
      const next: DbtColumnRef[] = []
      for (const ref of frontier) {
        const hops = direction === 'upstream' ? index.upstreamOf(ref) : index.downstreamOf(ref)
        for (const edge of hops) {
          const edgeKey = `${dbtColumnKey(edge.from)}->${dbtColumnKey(edge.to)}`
          if (seenEdges.has(edgeKey)) {
            continue
          }
          seenEdges.add(edgeKey)
          edges.push(edge)
          const far = direction === 'upstream' ? edge.from : edge.to
          const key = dbtColumnKey(far)
          if (!columns.has(key)) {
            columns.set(key, far)
            next.push(far)
          }
        }
      }
      frontier = next
    }
    return { edges, truncated: false }
  }
  const upstream = walk('upstream')
  const downstream = walk('downstream')
  return {
    columns: [...columns.values()],
    upstream: upstream.edges,
    downstream: downstream.edges,
    truncated: upstream.truncated || downstream.truncated
  }
}
