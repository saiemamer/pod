import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDbtCatalogTree, loadDbtCatalog, parseDbtCatalog } from './dbt-catalog'
import { parseDbtManifest } from './dbt-manifest'

const catalogJson = JSON.stringify({
  metadata: { generated_at: '2026-09-07T14:05:00Z' },
  nodes: {
    'model.demo.orders': {
      metadata: {
        type: 'table',
        schema: 'dbt',
        name: 'orders',
        database: 'proj'
      },
      columns: {
        status: { type: 'STRING', index: 2, name: 'status' },
        order_id: { type: 'INT64', index: 1, name: 'order_id', comment: 'pk' }
      }
    },
    'model.demo.other': {
      metadata: {
        type: 'view',
        schema: 'analytics',
        name: 'other',
        database: 'proj'
      },
      columns: {}
    }
  },
  sources: {
    'source.demo.raw.events': {
      metadata: {
        type: 'table',
        schema: 'raw',
        name: 'events',
        database: 'landing'
      },
      columns: { id: { type: 'INT64', index: 1, name: 'id' } }
    }
  }
})

const manifestJson = JSON.stringify({
  nodes: {
    'model.demo.orders': {
      name: 'orders',
      resource_type: 'model',
      original_file_path: 'models/orders.sql'
    },
    'model.demo.other': { name: 'other', resource_type: 'snapshot' }
  },
  sources: {
    'source.demo.raw.events': { name: 'events', resource_type: 'source' }
  }
})

describe('parseDbtCatalog', () => {
  it('reads relations with columns ordered by index', () => {
    const catalog = parseDbtCatalog('c.json', catalogJson)
    expect(catalog?.generatedAt).toBe('2026-09-07T14:05:00Z')
    expect(catalog?.nodes.size).toBe(3)
    const orders = catalog?.nodes.get('model.demo.orders')
    expect(orders?.database).toBe('proj')
    expect(orders?.columns.map((c) => c.name)).toEqual(['order_id', 'status'])
    expect(orders?.columns[0]).toEqual({
      name: 'order_id',
      type: 'INT64',
      index: 1,
      comment: 'pk'
    })
  })

  it('returns null for text that is not a JSON object', () => {
    expect(parseDbtCatalog('c.json', 'nope')).toBeNull()
    expect(parseDbtCatalog('c.json', '[]')).toBeNull()
  })
})

describe('buildDbtCatalogTree', () => {
  it('groups by database and schema and takes resource types from the manifest', () => {
    const tree = buildDbtCatalogTree(
      '/p',
      'c.json',
      parseDbtCatalog('c.json', catalogJson),
      parseDbtManifest('m.json', manifestJson)
    )
    expect(tree.exists).toBe(true)
    expect(tree.relationCount).toBe(3)
    expect(tree.databases.map((d) => d.name)).toEqual(['landing', 'proj'])
    const proj = tree.databases[1]
    expect(proj.schemas.map((s) => s.name)).toEqual(['analytics', 'dbt'])
    expect(proj.schemas[0].relations[0]).toMatchObject({
      name: 'other',
      type: 'view',
      resourceType: 'snapshot'
    })
    expect(proj.schemas[1].relations[0].path).toBe('models/orders.sql')
    expect(tree.databases[0].schemas[0].relations[0].resourceType).toBe('source')
  })

  it('lists a manifest model the catalog lacks with its documented columns', () => {
    const manifest = parseDbtManifest(
      'm.json',
      JSON.stringify({
        nodes: {
          ...JSON.parse(manifestJson).nodes,
          'model.demo.mart_revenue': {
            name: 'mart_revenue',
            resource_type: 'model',
            database: 'proj',
            schema: 'dbt_me',
            alias: 'revenue',
            original_file_path: 'models/marts/mart_revenue.sql',
            config: { materialized: 'table' },
            columns: {
              month: { name: 'month', description: 'First day of the month', data_type: 'date' },
              amount: { name: 'amount' }
            }
          },
          'model.demo.inlined': {
            name: 'inlined',
            resource_type: 'model',
            database: 'proj',
            schema: 'dbt_me',
            config: { materialized: 'ephemeral' }
          }
        }
      })
    )
    const tree = buildDbtCatalogTree(
      '/p',
      'c.json',
      parseDbtCatalog('c.json', catalogJson),
      manifest
    )
    const schema = tree.databases
      .find((d) => d.name === 'proj')
      ?.schemas.find((s) => s.name === 'dbt_me')
    expect(schema?.relations).toEqual([
      {
        name: 'revenue',
        uniqueId: 'model.demo.mart_revenue',
        resourceType: 'model',
        path: 'models/marts/mart_revenue.sql',
        type: undefined,
        comment: undefined,
        columns: [
          { name: 'month', index: 1, comment: 'First day of the month' },
          { name: 'amount', index: 2 }
        ],
        notBuilt: true
      }
    ])
    expect(tree.relationCount).toBe(4)
    // Built relations keep their catalog columns and types and carry no mark.
    const orders = tree.databases
      .find((d) => d.name === 'proj')
      ?.schemas.find((s) => s.name === 'dbt')?.relations[0]
    expect(orders?.columns[0].type).toBe('INT64')
    expect(orders?.notBuilt).toBeUndefined()
  })

  it('lists manifest relations without a not-built mark before any catalog exists', () => {
    const tree = buildDbtCatalogTree('/p', 'c.json', null, parseDbtManifest('m.json', manifestJson))
    expect(tree.exists).toBe(false)
    expect(tree.relationCount).toBe(3)
    const relations = tree.databases.flatMap((d) => d.schemas.flatMap((s) => s.relations))
    expect(relations.some((relation) => relation.notBuilt)).toBe(false)
  })

  it('reports a missing catalog', () => {
    expect(buildDbtCatalogTree('/p', 'c.json', null, null)).toEqual({
      projectDir: '/p',
      file: 'c.json',
      exists: false,
      databases: [],
      relationCount: 0
    })
  })
})

describe('loadDbtCatalog', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pod-catalog-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('caches by mtime and re-reads when the file changes', () => {
    const file = join(dir, 'catalog.json')
    writeFileSync(file, catalogJson)
    utimesSync(file, new Date(1000), new Date(1000))
    const first = loadDbtCatalog(file)
    expect(first?.nodes.size).toBe(3)
    expect(loadDbtCatalog(file)).toBe(first)
    writeFileSync(file, JSON.stringify({ nodes: {}, sources: {} }))
    utimesSync(file, new Date(2000), new Date(2000))
    expect(loadDbtCatalog(file)?.nodes.size).toBe(0)
    expect(loadDbtCatalog(join(dir, 'missing.json'))).toBeNull()
  })
})
