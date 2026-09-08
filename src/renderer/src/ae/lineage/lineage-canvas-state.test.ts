import { describe, expect, it } from 'vitest'
import type { DbtGraphNode, DbtGraphResult } from '../../../../shared/ae/dbt-graph-types'
import {
  highlightedColumnNames,
  lineageColumnsVisible,
  lineageHighlightFrom,
  lineageKind,
  lineageKindsIn,
  lineageSideCounts,
  mergeLineageGraphs,
  visibleLineageNodeIds
} from './lineage-canvas-state'
import {
  layoutLineage,
  lineageNodeHeight,
  lineageNodesNearViewport,
  LINEAGE_HEADER_HEIGHT,
  LINEAGE_NAME_MATCHED_FOOTER_HEIGHT,
  LINEAGE_NODE_SEP
} from './lineage-layout'

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
  it('keeps the base node objects for models both graphs carry', () => {
    const extra: DbtGraphResult = {
      ...graph,
      focus: 'c',
      nodes: [node('c', ['id']), node('d')],
      edges: [{ source: 'c', target: 'd' }]
    }
    const merged = mergeLineageGraphs(graph, extra)
    expect(merged.nodes.find((n) => n.uniqueId === 'c')).toBe(graph.nodes[3])
    expect(merged.nodes.map((n) => n.uniqueId)).toContain('d')
  })

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
    // Why the base object: one manifest graph feeds both answers, so the model the
    // canvas already holds is the same model; keeping it spares a re-render.
    expect(merged.nodes.find((n) => n.uniqueId === 'c')).toBe(graph.nodes[3])
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

describe('lineageKind', () => {
  it('maps resource types and materialisations to a colour family', () => {
    expect(lineageKind({ resourceType: 'source' })).toBe('source')
    expect(lineageKind({ resourceType: 'seed', materialized: 'seed' })).toBe('seed')
    expect(lineageKind({ resourceType: 'model', materialized: 'table' })).toBe('table')
    expect(lineageKind({ resourceType: 'model', materialized: 'materialized_view' })).toBe('view')
    expect(lineageKind({ resourceType: 'model' })).toBe('view')
    expect(lineageKind({ resourceType: 'model', materialized: 'dynamic_table' })).toBe('other')
    expect(
      lineageKindsIn([
        { ...node('a'), materialized: 'table' },
        { ...node('b'), resourceType: 'source' },
        { ...node('c'), materialized: 'table' }
      ])
    ).toEqual(['source', 'table'])
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
    // Why the gap: dagre reports centres and the answer must be top-left corners; a
    // spread of dagre's label once put the centre back, and tall boxes overlapped.
    expect(placed.x.y - (placed.a.y + placed.a.height)).toBe(LINEAGE_NODE_SEP)
    expect(placed.b.height).toBe(lineageNodeHeight(2, true))
    expect(placed.c.height).toBe(LINEAGE_HEADER_HEIGHT)
    expect(lineageNodeHeight(30, true)).toBe(lineageNodeHeight(15, true))
    expect(lineageNodeHeight(30, false)).toBe(LINEAGE_HEADER_HEIGHT)
    // Why: the "columns matched by name" footer grows a box after a click without a
    // re-layout, so the gap between boxes must be taller than the footer.
    expect(LINEAGE_NAME_MATCHED_FOOTER_HEIGHT).toBeLessThan(LINEAGE_NODE_SEP / 2)
  })

  it('keeps the same placement for the same graph', () => {
    // Why a snapshot: dagre's ordering is deterministic; a change here means the
    // layout options or the size model moved, which the canvas would show.
    const placed = layoutLineage(
      graph.nodes.map((n) => ({
        id: n.uniqueId,
        columnCount: n.columns.length,
        showColumns: true
      })),
      graph.edges
    )
    expect(
      Object.fromEntries(
        Object.entries(placed).map(([id, box]) => [
          id,
          `${box.x},${box.y} ${box.width}x${box.height}`
        ])
      )
    ).toMatchInlineSnapshot(`
      {
        "a": "328,0 232x66",
        "b": "656,47 232x86",
        "c": "984,70 232x40",
        "raw": "0,0 232x66",
        "x": "328,114 232x66",
      }
    `)
  })

  it('hides columns below the zoom threshold', () => {
    expect(lineageColumnsVisible(true, 0.5)).toBe(false)
    expect(lineageColumnsVisible(true, 0.6)).toBe(true)
    expect(lineageColumnsVisible(false, 2)).toBe(false)
  })
})

describe('lineageNodesNearViewport', () => {
  const placed = layoutLineage(
    graph.nodes.map((n) => ({ id: n.uniqueId, columnCount: n.columns.length, showColumns: true })),
    graph.edges
  )

  it('lists the nodes inside the visible area, then those within the margin', () => {
    // A 400x300 viewport at 100 percent whose top-left sits on b's box.
    const viewport = { x: -placed.b.x, y: -placed.b.y, zoom: 1, width: 400, height: 300 }
    expect(lineageNodesNearViewport(placed, {}, viewport, 0)).toEqual(['b', 'c'])
    expect(lineageNodesNearViewport(placed, {}, viewport, 1).sort()).toEqual(
      ['a', 'b', 'c', 'x'].sort()
    )
  })

  it('accounts for zoom and dragged positions', () => {
    const viewport = { x: 0, y: 0, zoom: 0.5, width: 300, height: 300 }
    // Half zoom shows 600x600 flow units from the origin: raw, a and x, not b at 772.
    expect(lineageNodesNearViewport(placed, {}, viewport, 0)).toEqual(['raw', 'a', 'x'])
    expect(lineageNodesNearViewport(placed, { b: { x: 0, y: 0 } }, viewport, 0)).toEqual([
      'raw',
      'a',
      'b',
      'x'
    ])
    expect(lineageNodesNearViewport(placed, {}, { ...viewport, width: 0 }, 1)).toEqual([])
  })
})
