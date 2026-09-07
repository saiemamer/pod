import { describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import type { DbtGraphNode } from '../../../shared/ae/dbt-graph-types'
import { parseDbtCatalog } from './dbt-catalog'
import { bareRelationName, buildSidecarInput, DbtColumnLineageService } from './dbt-column-lineage'
import { buildDbtGraphIndex, type DbtGraph, type DbtGraphSqlSource } from './dbt-graph'
import { parseDbtManifest, type DbtManifestNode } from './dbt-manifest'
import type { DbtProjectInfo } from './dbt-project-discovery'
import { DbtSqlglotSidecar, type SqlglotOutput } from './dbt-sqlglot-sidecar'

const manifestJson = JSON.stringify({
  nodes: {
    'model.demo.orders': {
      name: 'orders',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/marts/orders.sql',
      database: 'proj',
      schema: 'dbt',
      alias: 'orders',
      relation_name: '`proj`.`dbt`.`orders`',
      depends_on: { nodes: ['model.demo.stg_orders'] }
    },
    'model.demo.stg_orders': {
      name: 'stg_orders',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/stg_orders.sql',
      database: 'proj',
      schema: 'dbt',
      relation_name: '`proj`.`dbt`.`stg_orders`',
      depends_on: { nodes: ['source.demo.raw.orders'] }
    },
    'model.demo.summary': {
      name: 'summary',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/summary.sql',
      depends_on: { nodes: ['model.demo.orders'] }
    }
  },
  sources: {
    'source.demo.raw.orders': {
      name: 'orders',
      resource_type: 'source',
      package_name: 'demo',
      database: 'landing',
      schema: 'raw',
      identifier: 'orders_raw',
      columns: {
        id: { name: 'id' },
        status: { name: 'status' },
        amount: { name: 'amount' }
      }
    }
  },
  parent_map: {
    'model.demo.orders': ['model.demo.stg_orders'],
    'model.demo.stg_orders': ['source.demo.raw.orders'],
    'model.demo.summary': ['model.demo.orders']
  },
  child_map: {}
})

const catalogJson = JSON.stringify({
  nodes: {
    'model.demo.orders': {
      metadata: { name: 'orders', schema: 'dbt', database: 'proj' },
      columns: {
        order_id: { index: 1 },
        status: { index: 2 },
        key: { index: 3 }
      }
    },
    'model.demo.stg_orders': {
      metadata: { name: 'stg_orders', schema: 'dbt', database: 'proj' },
      columns: { order_id: { index: 1 }, status: { index: 2 } }
    }
  },
  sources: {}
})

const sql: Record<string, DbtGraphSqlSource> = {
  'models/marts/orders.sql': {
    source: 'compiled',
    text: 'select order_id, status, cast(order_id as string) || status as key from `proj`.`dbt`.`stg_orders`'
  },
  'models/stg_orders.sql': {
    source: 'source',
    text: "select id as order_id, status from {{ source('raw', 'orders') }}"
  },
  'models/summary.sql': {
    source: 'source',
    text: 'select status, count(*) as n from {{ ref("orders") }} group by 1'
  }
}

const project: DbtProjectInfo = {
  projectDir: '/p',
  projectFile: '/p/dbt_project.yml',
  name: 'demo',
  modelPaths: ['models'],
  macroPaths: [],
  targetPath: 'target'
}

function makeGraph(): DbtGraph {
  const manifest = parseDbtManifest('m.json', manifestJson)!
  const catalog = parseDbtCatalog('c.json', catalogJson)
  const readSql = (node: DbtManifestNode): DbtGraphSqlSource | null =>
    sql[node.originalFilePath] ?? null
  return {
    projectDir: '/p',
    manifestMtimeMs: 1,
    catalogMtimeMs: 1,
    catalogExists: true,
    manifest,
    index: buildDbtGraphIndex(manifest, catalog, readSql)
  }
}

const readSql = (_project: DbtProjectInfo, node: DbtManifestNode): DbtGraphSqlSource | null =>
  sql[node.originalFilePath] ?? null

describe('bareRelationName', () => {
  it('strips quoting and falls back to database.schema.identifier', () => {
    const manifest = parseDbtManifest('m.json', manifestJson)!
    expect(bareRelationName(manifest.nodes.get('model.demo.orders')!)).toBe('proj.dbt.orders')
    expect(bareRelationName(manifest.nodes.get('source.demo.raw.orders')!)).toBe(
      'landing.raw.orders_raw'
    )
  })
})

describe('buildSidecarInput', () => {
  it('keys compiled SQL by relation name and stripped SQL by ref identifier', () => {
    const graph = makeGraph()
    const compiled = buildSidecarInput(
      graph,
      graph.index.nodes.get('model.demo.orders')!,
      sql['models/marts/orders.sql']
    )
    expect(compiled.input.schema).toEqual({
      'proj.dbt.stg_orders': ['order_id', 'status']
    })
    expect(compiled.relations.get('proj.dbt.stg_orders')).toBe('model.demo.stg_orders')
    const stripped = buildSidecarInput(
      graph,
      graph.index.nodes.get('model.demo.stg_orders')!,
      sql['models/stg_orders.sql']
    )
    expect(stripped.input.sql).toBe('select id as order_id, status from raw__orders')
    expect(stripped.input.schema).toEqual({
      raw__orders: ['id', 'status', 'amount']
    })
    expect(stripped.relations.get('raw__orders')).toBe('source.demo.raw.orders')
  })
})

function fakeSidecar(output: SqlglotOutput | null, calls: unknown[] = []): DbtSqlglotSidecar {
  const sidecar = new DbtSqlglotSidecar({
    run: async () => ({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })
  })
  vi.spyOn(sidecar, 'status').mockResolvedValue(
    output
      ? {
          engine: 'sqlglot',
          python: '/py',
          pythonSource: 'settings',
          sqlglotVersion: '30'
        }
      : { engine: 'name-match', note: 'No python3 on PATH' }
  )
  vi.spyOn(sidecar, 'analyse').mockImplementation(async (_python, _env, _dialect, nodes) => {
    calls.push(nodes.map((n) => n.id))
    return output ?? { ok: false, error: 'unused' }
  })
  return sidecar
}

const focusOf = (graph: DbtGraph, id: string): DbtGraphNode => graph.index.nodes.get(id)!
const engineContext = { python: '/py', env: {}, dialect: 'bigquery' }

describe('DbtColumnLineageService', () => {
  it('follows sqlglot answers across the neighbourhood and caches per node', async () => {
    const graph = makeGraph()
    const calls: unknown[] = []
    const sidecar = fakeSidecar(
      {
        ok: true,
        sqlglot: '30',
        nodes: {
          'model.demo.orders': {
            ok: true,
            outputs: ['order_id', 'status', 'key'],
            columns: {
              order_id: [{ relation: 'proj.dbt.stg_orders', column: 'order_id' }],
              status: [{ relation: 'proj.dbt.stg_orders', column: 'status' }],
              key: [
                { relation: 'proj.dbt.stg_orders', column: 'order_id' },
                { relation: 'proj.dbt.stg_orders', column: 'status' }
              ]
            }
          },
          'model.demo.stg_orders': {
            ok: true,
            outputs: ['order_id', 'status'],
            columns: {
              order_id: [{ relation: 'raw__orders', column: 'id' }],
              status: [{ relation: 'raw__orders', column: 'status' }]
            }
          },
          'model.demo.summary': { ok: false, error: 'ParseError' }
        }
      },
      calls
    )
    const service = new DbtColumnLineageService(sidecar, readSql)
    const result = await service.lineage(
      graph,
      project,
      focusOf(graph, 'model.demo.orders'),
      engineContext,
      { path: '/p', model: 'orders', column: 'STATUS' },
      { depth: 4, maxNodes: 100 }
    )
    expect(result.focus).toEqual({
      uniqueId: 'model.demo.orders',
      column: 'status'
    })
    expect(result.engine).toBe('sqlglot')
    // Why no orders.key: it derives from stg_orders.status too, but that is a sibling of
    // the focus, not on the path away from it.
    expect(result.columns.map((c) => `${c.uniqueId}:${c.column}`).sort()).toEqual([
      'model.demo.orders:status',
      'model.demo.stg_orders:status',
      'model.demo.summary:status',
      'source.demo.raw.orders:status'
    ])
    expect(result.upstream.map((e) => e.engine)).toEqual(['sqlglot', 'sqlglot'])
    expect(result.downstream).toEqual([
      expect.objectContaining({
        from: { uniqueId: 'model.demo.orders', column: 'status' },
        to: { uniqueId: 'model.demo.summary', column: 'status' },
        engine: 'name-match'
      })
    ])
    expect(result.nameMatchedNodes).toEqual(['model.demo.summary'])
    expect(result.truncated).toBe(false)
    expect(calls).toEqual([['model.demo.orders', 'model.demo.stg_orders', 'model.demo.summary']])
    // Why one call: every node's answer, the failed parse included, is cached by its SQL.
    await service.lineage(
      graph,
      project,
      focusOf(graph, 'model.demo.orders'),
      engineContext,
      { path: '/p', model: 'orders', column: 'order_id' },
      { depth: 4, maxNodes: 100 }
    )
    expect(calls).toHaveLength(1)
  })

  it('name-matches everything when there is no python', async () => {
    const graph = makeGraph()
    const service = new DbtColumnLineageService(fakeSidecar(null), readSql)
    const result = await service.lineage(
      graph,
      project,
      focusOf(graph, 'model.demo.stg_orders'),
      engineContext,
      { path: '/p', model: 'stg_orders', column: 'status' },
      { depth: 4, maxNodes: 100 }
    )
    expect(result.engine).toBe('name-match')
    expect(result.engineNote).toBe('No python3 on PATH')
    expect(result.columns.map((c) => c.uniqueId).sort()).toEqual([
      'model.demo.orders',
      'model.demo.stg_orders',
      'model.demo.summary',
      'source.demo.raw.orders'
    ])
    expect(result.nameMatchedNodes.sort()).toEqual([
      'model.demo.orders',
      'model.demo.stg_orders',
      'model.demo.summary'
    ])
  })

  it('rejects an unknown column', async () => {
    const graph = makeGraph()
    const service = new DbtColumnLineageService(fakeSidecar(null), readSql)
    await expect(
      service.lineage(
        graph,
        project,
        focusOf(graph, 'model.demo.orders'),
        engineContext,
        { path: '/p', model: 'orders', column: 'nope' },
        { depth: 4, maxNodes: 100 }
      )
    ).rejects.toThrow(/no column named "nope"/)
  })

  // Why gated: CI has no sqlglot; locally, POD_SQLGLOT_PYTHON points at a venv that has it.
  const python = process.env.POD_SQLGLOT_PYTHON
  it.skipIf(!python)('answers through the real sqlglot sidecar', async () => {
    const graph = makeGraph()
    const service = new DbtColumnLineageService(new DbtSqlglotSidecar({ run: runProcess }), readSql)
    const result = await service.lineage(
      graph,
      project,
      focusOf(graph, 'model.demo.orders'),
      { python, env: process.env, dialect: 'bigquery' },
      { path: '/p', model: 'orders', column: 'key' },
      { depth: 4, maxNodes: 100 }
    )
    expect(result.engine).toBe('sqlglot')
    expect(result.upstream.map((e) => `${e.from.uniqueId}:${e.from.column}`).sort()).toEqual([
      'model.demo.stg_orders:order_id',
      'model.demo.stg_orders:status',
      'source.demo.raw.orders:id',
      'source.demo.raw.orders:status'
    ])
    expect(result.nameMatchedNodes).toEqual([])
  })
})
