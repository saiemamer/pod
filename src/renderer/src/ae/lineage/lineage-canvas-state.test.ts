import { describe, expect, it } from 'vitest'
import type { DbtGraphNode, DbtGraphResult } from '../../../../shared/ae/dbt-graph-types'
import {
  highlightedColumnNames,
  lineageColumnsVisible,
  lineageHighlightFrom,
  lineageSideCounts,
  mergeLineageGraphs,
  visibleLineageNodeIds
} from './lineage-canvas-state'
import { layoutLineage, lineageNodeHeight, LINEAGE_HEADER_HEIGHT } from './lineage-layout'

function node(id: string, columns: string[] = []): DbtGraphNode {
  return {
    uniqueId: id,
    name: id.split('.').at(-1) ?? id,
    resourceType: 'model',
    packageName: 'demo',
    path: `models/${id}.sql`,
    columns: columns.map((name) => ({ name, source: 'catalog' as const })),
    columnSource: 'catalog'
  }
}

// raw -> a -> b -> c; x -> b
const graph: DbtGraphResult = {
  projectDir: '/p',
  focus: 'b',
  nodes: [
    node('raw', ['id']),
    node('a', ['id']),
    node('b', ['id', 'n']),
    node('c'),
    node('x', ['n'])
  ],
  edges: [
    { source: 'raw', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'x', target: 'b' },
    { source: 'b', target: 'c' }
  ],
  upstreamDepth: 2,
  downstreamDepth: 1,
  truncated: false,
  moreUpstream: {},
  moreDownstream: { c: 2 },
  totalNodes: 9,
  catalogExists: true
}

describe('visibleLineageNodeIds', () => {
  it('shows everything reachable from the focus without collapses', () => {
    expect([...visibleLineageNodeIds(graph, { up: new Set(), down: new Set() })].sort()).toEqual([
      'a',
      'b',
      'c',
      'raw',
      'x'
    ])
  })

  it('hides what lies past a collapsed handle, but not the node itself', () => {
    const visible = visibleLineageNodeIds(graph, { up: new Set(['a']), down: new Set(['b']) })
    expect([...visible].sort()).toEqual(['a', 'b', 'x'])
    expect(lineageSideCounts(graph, visible)).toEqual({
      a: { up: 0, down: 1 },
      b: { up: 2, down: 0 },
      x: { up: 0, down: 1 }
    })
  })
})

describe('mergeLineageGraphs', () => {
  it('adds nodes and edges once and replaces the expanded node counts', () => {
    const extra: DbtGraphResult = {
      ...graph,
      focus: 'c',
      nodes: [node('c', ['id']), node('d'), node('e')],
      edges: [
        { source: 'c', target: 'd' },
        { source: 'c', target: 'e' },
        { source: 'b', target: 'c' }
      ],
      moreUpstream: {},
      moreDownstream: { d: 1 }
    }
    const merged = mergeLineageGraphs(graph, extra)
    expect(merged.nodes.map((n) => n.uniqueId)).toEqual(['raw', 'a', 'b', 'c', 'x', 'd', 'e'])
    expect(merged.nodes.find((n) => n.uniqueId === 'c')?.columns).toHaveLength(1)
    expect(merged.edges).toHaveLength(6)
    expect(merged.moreDownstream).toEqual({ d: 1 })
  })
})

describe('lineageHighlightFrom', () => {
  it('lights the columns and nodes on the path', () => {
    const highlight = lineageHighlightFrom({
      focus: { uniqueId: 'b', column: 'id' },
      columns: [
        { uniqueId: 'b', column: 'id' },
        { uniqueId: 'a', column: 'ID' }
      ],
      upstream: [
        {
          from: { uniqueId: 'a', column: 'ID' },
          to: { uniqueId: 'b', column: 'id' },
          engine: 'sqlglot'
        }
      ],
      downstream: [],
      engine: 'sqlglot',
      nameMatchedNodes: [],
      truncated: false
    })
    expect(highlight?.nodes).toEqual(new Set(['b', 'a']))
    expect(highlightedColumnNames(node('a', ['id', 'other']), highlight)).toEqual(['id'])
    expect(highlightedColumnNames(node('x', ['id']), highlight)).toEqual([])
    expect(lineageHighlightFrom(null)).toBeNull()
  })
})

describe('layoutLineage', () => {
  it('places parents left of children and sizes nodes by their columns', () => {
    const placed = layoutLineage(
      graph.nodes.map((n) => ({
        id: n.uniqueId,
        columnCount: n.columns.length,
        showColumns: true
      })),
      graph.edges
    )
    expect(placed.raw.x).toBeLessThan(placed.a.x)
    expect(placed.a.x).toBeLessThan(placed.b.x)
    expect(placed.x.x).toBeLessThan(placed.b.x)
    expect(placed.b.x).toBeLessThan(placed.c.x)
    expect(placed.b.height).toBe(lineageNodeHeight(2, true))
    expect(placed.c.height).toBe(LINEAGE_HEADER_HEIGHT)
    expect(lineageNodeHeight(30, true)).toBe(lineageNodeHeight(15, true))
    expect(lineageNodeHeight(30, false)).toBe(LINEAGE_HEADER_HEIGHT)
  })

  it('hides columns below the zoom threshold', () => {
    expect(lineageColumnsVisible(true, 0.5)).toBe(false)
    expect(lineageColumnsVisible(true, 0.6)).toBe(true)
    expect(lineageColumnsVisible(false, 2)).toBe(false)
  })
})
