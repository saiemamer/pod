import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDbtCatalog } from './dbt-catalog'
import {
  buildDbtGraphIndex,
  DbtGraphNotReadyError,
  DbtGraphService,
  modelNameFromPath,
  readDbtNodeSql
} from './dbt-graph'
import { parseDbtManifest } from './dbt-manifest'
import type { DbtProjectInfo } from './dbt-project-discovery'

const manifestJson = JSON.stringify({
  metadata: { generated_at: '2026-09-07T14:00:00Z' },
  nodes: {
    'model.demo.orders': {
      name: 'orders',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/marts/orders.sql',
      config: { materialized: 'table' },
      columns: { order_id: { name: 'order_id', description: 'pk' } },
      depends_on: { nodes: ['model.demo.stg_orders'] }
    },
    'model.demo.stg_orders': {
      name: 'stg_orders',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/stg_orders.sql',
      depends_on: { nodes: ['source.demo.raw.orders'] }
    },
    'model.demo.summary': {
      name: 'summary',
      resource_type: 'model',
      package_name: 'demo',
      original_file_path: 'models/summary.sql',
      depends_on: { nodes: ['model.demo.orders'] }
    },
    'test.demo.not_null': { name: 'not_null', resource_type: 'test' }
  },
  sources: {
    'source.demo.raw.orders': {
      name: 'orders',
      resource_type: 'source',
      package_name: 'demo',
      identifier: 'orders_raw',
      columns: {
        id: { name: 'id', data_type: 'INT64' },
        status: { name: 'status' }
      }
    }
  },
  parent_map: {
    'model.demo.orders': ['model.demo.stg_orders'],
    'model.demo.stg_orders': ['source.demo.raw.orders'],
    'model.demo.summary': ['model.demo.orders', 'test.demo.not_null']
  },
  child_map: {}
})

const catalogJson = JSON.stringify({
  nodes: {
    'model.demo.orders': {
      metadata: {
        name: 'orders',
        schema: 'dbt',
        database: 'proj',
        type: 'table'
      },
      columns: {
        status: { type: 'STRING', index: 2 },
        order_id: { type: 'INT64', index: 1 }
      }
    }
  },
  sources: {}
})

const sqlByPath: Record<string, string> = {
  'models/stg_orders.sql':
    "select id as order_id, status, {{ var('x') }} as flag from {{ source('raw', 'orders') }}",
  'models/summary.sql': 'select * from {{ ref("orders") }}'
}

describe('buildDbtGraphIndex', () => {
  const manifest = parseDbtManifest('m.json', manifestJson)!
  const catalog = parseDbtCatalog('c.json', catalogJson)

  it('takes columns from catalog, then manifest, then the select list, then parents', () => {
    const index = buildDbtGraphIndex(manifest, catalog, (node) => {
      const text = sqlByPath[node.originalFilePath]
      return text ? { text, source: 'source' } : null
    })
    expect([...index.nodes.keys()].sort()).toEqual([
      'model.demo.orders',
      'model.demo.stg_orders',
      'model.demo.summary',
      'source.demo.raw.orders'
    ])
    const orders = index.nodes.get('model.demo.orders')!
    expect(orders.columnSource).toBe('catalog')
    expect(orders.columns).toEqual([
      {
        name: 'order_id',
        dataType: 'INT64',
        description: 'pk',
        source: 'catalog'
      },
      {
        name: 'status',
        dataType: 'STRING',
        description: undefined,
        source: 'catalog'
      }
    ])
    expect(orders.materialized).toBe('table')
    const source = index.nodes.get('source.demo.raw.orders')!
    expect(source.columnSource).toBe('manifest')
    expect(source.alias).toBe('orders_raw')
    const staging = index.nodes.get('model.demo.stg_orders')!
    expect(staging.columnSource).toBe('parsed')
    expect(staging.columns.map((c) => c.name)).toEqual(['order_id', 'status', 'flag'])
    const summary = index.nodes.get('model.demo.summary')!
    expect(summary.columnSource).toBe('inherited')
    expect(summary.columns.map((c) => c.name)).toEqual(['order_id', 'status'])
    // Why: the test node is not a lineage node, so its edge is dropped.
    expect(index.parents.get('model.demo.summary')).toEqual(['model.demo.orders'])
  })
})

describe('DbtGraphService', () => {
  let dir: string
  let project: DbtProjectInfo
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pod-graph-'))
    mkdirSync(join(dir, 'target', 'compiled', 'demo', 'models', 'marts'), {
      recursive: true
    })
    mkdirSync(join(dir, 'models', 'marts'), { recursive: true })
    writeFileSync(join(dir, 'target', 'manifest.json'), manifestJson)
    writeFileSync(join(dir, 'target', 'catalog.json'), catalogJson)
    writeFileSync(join(dir, 'models', 'stg_orders.sql'), sqlByPath['models/stg_orders.sql'])
    writeFileSync(join(dir, 'models', 'summary.sql'), sqlByPath['models/summary.sql'])
    writeFileSync(join(dir, 'models', 'marts', 'orders.sql'), 'select 1')
    writeFileSync(
      join(dir, 'target', 'compiled', 'demo', 'models', 'marts', 'orders.sql'),
      'select order_id, status from `proj`.`dbt`.`stg_orders`'
    )
    project = {
      projectDir: dir,
      projectFile: join(dir, 'dbt_project.yml'),
      name: 'demo',
      modelPaths: ['models'],
      macroPaths: ['macros'],
      targetPath: 'target'
    }
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers the compiled file and falls back to the model file', () => {
    const manifest = parseDbtManifest('m.json', manifestJson)!
    expect(readDbtNodeSql(project, manifest.nodes.get('model.demo.orders')!)).toEqual({
      text: 'select order_id, status from `proj`.`dbt`.`stg_orders`',
      source: 'compiled'
    })
    expect(readDbtNodeSql(project, manifest.nodes.get('model.demo.summary')!)?.source).toBe(
      'source'
    )
    expect(readDbtNodeSql(project, manifest.nodes.get('source.demo.raw.orders')!)).toBeNull()
  })

  it('builds a neighbourhood around the file name and caches by mtime', () => {
    const service = new DbtGraphService()
    const graph = service.load(project)
    expect(service.load(project)).toBe(graph)
    const result = service.neighbourhood(
      graph,
      { path: join(dir, 'models', 'marts', 'orders.sql'), downstreamDepth: 0 },
      { depth: 1, maxNodes: 100 }
    )
    expect(result.focus).toBe('model.demo.orders')
    expect(result.nodes.map((n) => n.uniqueId).sort()).toEqual([
      'model.demo.orders',
      'model.demo.stg_orders'
    ])
    expect(result.moreUpstream).toEqual({ 'model.demo.stg_orders': 1 })
    expect(result.moreDownstream).toEqual({ 'model.demo.orders': 1 })
    expect(result.totalNodes).toBe(4)
    expect(result.catalogExists).toBe(true)
    // Why touch the catalog: a rebuild must follow a new docs generate.
    utimesSync(join(dir, 'target', 'catalog.json'), new Date(5000), new Date(5000))
    expect(service.load(project)).not.toBe(graph)
  })

  it('names the focus model explicitly and rejects unknown names', () => {
    const service = new DbtGraphService()
    const graph = service.load(project)
    expect(service.focusNode(graph, { model: 'summary', path: dir }).uniqueId).toBe(
      'model.demo.summary'
    )
    expect(() => service.focusNode(graph, { model: 'nope', path: dir })).toThrow(/No model named/)
  })

  it('throws a readable error without a manifest', () => {
    rmSync(join(dir, 'target', 'manifest.json'))
    expect(() => new DbtGraphService().load(project)).toThrow(DbtGraphNotReadyError)
  })

  it('derives model names from paths', () => {
    expect(modelNameFromPath('/repo/models/marts/orders.sql')).toBe('orders')
    expect(modelNameFromPath('orders.SQL')).toBe('orders')
  })
})
