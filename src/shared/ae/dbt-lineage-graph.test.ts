import { describe, expect, it } from 'vitest'
import type { DbtColumnLineageEdge, DbtGraphNode } from './dbt-graph-types'
import {
  indexDbtColumnEdges,
  indexDbtGraph,
  inheritDbtColumns,
  propagateDbtColumnLineage,
  selectDbtNeighbourhood
} from './dbt-lineage-graph'

function node(id: string, columns: string[] = []): DbtGraphNode {
  return {
    uniqueId: id,
    name: id.split('.').at(-1) ?? id,
    resourceType: id.startsWith('source.') ? 'source' : 'model',
    packageName: 'demo',
    path: `models/${id}.sql`,
    columns: columns.map((name) => ({ name, source: 'catalog' as const })),
    columnSource: columns.length > 0 ? 'catalog' : 'none'
  }
}

// source.raw -> a -> b -> c -> d; x -> c
const edges = [
  { source: 'source.raw', target: 'model.a' },
  { source: 'model.a', target: 'model.b' },
  { source: 'model.b', target: 'model.c' },
  { source: 'model.c', target: 'model.d' },
  { source: 'model.x', target: 'model.c' }
]

describe('selectDbtNeighbourhood', () => {
  const index = indexDbtGraph(
    ['source.raw', 'model.a', 'model.b', 'model.c', 'model.d', 'model.x'].map((id) => node(id)),
    edges
  )

  it('walks both directions to the requested depths and counts what lies beyond', () => {
    const hood = selectDbtNeighbourhood(index, 'model.c', {
      upstreamDepth: 1,
      downstreamDepth: 1,
      maxNodes: 100
    })
    expect(hood.nodeIds.sort()).toEqual(['model.b', 'model.c', 'model.d', 'model.x'])
    expect(hood.edges).toEqual(
      expect.arrayContaining([
        { source: 'model.b', target: 'model.c' },
        { source: 'model.x', target: 'model.c' },
        { source: 'model.c', target: 'model.d' }
      ])
    )
    expect(hood.edges).toHaveLength(3)
    expect(hood.moreUpstream).toEqual({ 'model.b': 1 })
    expect(hood.moreDownstream).toEqual({})
    expect(hood.truncated).toBe(false)
  })

  it('caps the node count, alternating sides, and flags truncation', () => {
    const hood = selectDbtNeighbourhood(index, 'model.c', {
      upstreamDepth: 5,
      downstreamDepth: 5,
      maxNodes: 3
    })
    expect(hood.nodeIds).toHaveLength(3)
    expect(hood.nodeIds).toContain('model.c')
    expect(hood.nodeIds).toContain('model.d')
    expect(hood.truncated).toBe(true)
    expect(Object.values(hood.moreUpstream).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('ignores edges to nodes that are not in the graph', () => {
    const small = indexDbtGraph([node('model.a')], [{ source: 'model.zzz', target: 'model.a' }])
    expect(small.parents.get('model.a')).toBeUndefined()
  })
})

describe('inheritDbtColumns', () => {
  it('fills empty nodes from their parents to a fixpoint', () => {
    const index = indexDbtGraph(
      [
        node('source.raw', ['id', 'status']),
        node('model.a'),
        node('model.b'),
        node('model.c'),
        node('model.d'),
        node('model.x', ['id', 'extra'])
      ],
      edges
    )
    expect(inheritDbtColumns(index)).toBe(4)
    expect(index.nodes.get('model.b')?.columns.map((c) => c.name)).toEqual(['id', 'status'])
    expect(index.nodes.get('model.b')?.columnSource).toBe('inherited')
    expect(index.nodes.get('model.c')?.columns.map((c) => c.name)).toEqual([
      'id',
      'status',
      'extra'
    ])
    expect(index.nodes.get('model.d')?.columns.map((c) => c.name)).toEqual([
      'id',
      'status',
      'extra'
    ])
  })

  it('expands a star beside named columns from the parents, own columns last', () => {
    const star = node('model.wide', ['flag'])
    star.selectsStar = true
    const index = indexDbtGraph(
      [node('source.raw', ['id', 'status']), node('model.a'), star],
      [
        { source: 'source.raw', target: 'model.a' },
        { source: 'model.a', target: 'model.wide' }
      ]
    )
    expect(inheritDbtColumns(index)).toBe(1)
    expect(index.nodes.get('model.wide')?.columns.map((c) => `${c.name}:${c.source}`)).toEqual([
      'id:inherited',
      'status:inherited',
      'flag:catalog'
    ])
    expect(index.nodes.get('model.wide')?.columnSource).toBe('catalog')
  })

  it('stops at the pass cap', () => {
    // Why reversed: a pass visits nodes in order, so children listed first cannot
    // pick up what their parents receive later in the same pass.
    const index = indexDbtGraph(
      [
        node('model.x'),
        node('model.d'),
        node('model.c'),
        node('model.b'),
        node('model.a'),
        node('source.raw', ['id'])
      ],
      edges
    )
    expect(inheritDbtColumns(index, 1)).toBe(1)
    expect(index.nodes.get('model.b')?.columns).toEqual([])
  })
})

describe('propagateDbtColumnLineage', () => {
  const edge = (from: string, to: string): DbtColumnLineageEdge => {
    const [fu, fc] = from.split(':')
    const [tu, tc] = to.split(':')
    return {
      from: { uniqueId: fu, column: fc },
      to: { uniqueId: tu, column: tc },
      engine: 'sqlglot'
    }
  }
  const index = indexDbtColumnEdges([
    edge('source.raw:id', 'model.a:id'),
    edge('model.a:id', 'model.b:order_id'),
    edge('model.b:order_id', 'model.c:order_id'),
    edge('model.b:order_id', 'model.c:key'),
    edge('model.b:status', 'model.c:key'),
    edge('model.c:order_id', 'model.d:order_id')
  ])

  it('lights up every column on the path in both directions', () => {
    const result = propagateDbtColumnLineage({ uniqueId: 'model.b', column: 'ORDER_ID' }, index)
    expect(result.columns.map((c) => `${c.uniqueId}:${c.column}`).sort()).toEqual([
      'model.a:id',
      'model.b:ORDER_ID',
      'model.c:key',
      'model.c:order_id',
      'model.d:order_id',
      'source.raw:id'
    ])
    expect(result.upstream).toHaveLength(2)
    expect(result.downstream).toHaveLength(3)
    expect(result.truncated).toBe(false)
  })

  it('stops at the pass cap and says so', () => {
    const result = propagateDbtColumnLineage({ uniqueId: 'model.b', column: 'order_id' }, index, 1)
    expect(result.upstream).toHaveLength(1)
    expect(result.downstream).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})
