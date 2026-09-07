import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dbtManifestPath,
  findDbtManifestNode,
  listDbtManifestModels,
  loadDbtManifest,
  parseDbtManifest,
  walkDbtLineage
} from './dbt-manifest'

export const FIXTURE_MANIFEST = {
  metadata: { generated_at: '2026-09-07T12:00:00Z', dbt_version: '1.9.0', project_name: 'demo' },
  nodes: {
    'model.demo.stg_orders': {
      name: 'stg_orders',
      resource_type: 'model',
      package_name: 'demo',
      path: 'staging/stg_orders.sql',
      original_file_path: 'models/staging/stg_orders.sql',
      database: 'proj',
      schema: 'dbt',
      config: { materialized: 'view' },
      tags: ['staging'],
      columns: { id: { name: 'id', description: 'pk', data_type: 'INT64' } },
      depends_on: { nodes: ['source.demo.shop.orders'] }
    },
    'model.demo.fct_orders': {
      name: 'fct_orders',
      resource_type: 'model',
      package_name: 'demo',
      path: 'marts/fct_orders.sql',
      original_file_path: 'models/marts/fct_orders.sql',
      config: { materialized: 'table' },
      depends_on: { nodes: ['model.demo.stg_orders'] }
    },
    'test.demo.unique_fct_orders_id': {
      name: 'unique_fct_orders_id',
      resource_type: 'test',
      package_name: 'demo',
      path: 'x.sql',
      original_file_path: 'models/marts/schema.yml',
      depends_on: { nodes: ['model.demo.fct_orders'] }
    }
  },
  sources: {
    'source.demo.shop.orders': {
      name: 'orders',
      resource_type: 'source',
      package_name: 'demo',
      path: 'models/sources.yml',
      original_file_path: 'models/sources.yml'
    }
  },
  parent_map: {
    'model.demo.stg_orders': ['source.demo.shop.orders'],
    'model.demo.fct_orders': ['model.demo.stg_orders'],
    'test.demo.unique_fct_orders_id': ['model.demo.fct_orders']
  },
  child_map: {
    'source.demo.shop.orders': ['model.demo.stg_orders'],
    'model.demo.stg_orders': ['model.demo.fct_orders'],
    'model.demo.fct_orders': ['test.demo.unique_fct_orders_id']
  }
}

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseDbtManifest', () => {
  it('keeps models, sources and the edge maps, with the fields Pod shows', () => {
    const manifest = parseDbtManifest('/m.json', JSON.stringify(FIXTURE_MANIFEST))
    expect(manifest?.projectName).toBe('demo')
    expect(manifest?.nodes.size).toBe(4)
    expect(manifest?.nodes.get('model.demo.stg_orders')).toMatchObject({
      name: 'stg_orders',
      materialized: 'view',
      tags: ['staging'],
      columns: [{ name: 'id', description: 'pk', dataType: 'INT64' }],
      dependsOn: ['source.demo.shop.orders']
    })
    expect(parseDbtManifest('/m.json', 'nope')).toBeNull()
  })

  it('finds nodes by name (models first) or unique id, and lists models sorted', () => {
    const manifest = parseDbtManifest('/m.json', JSON.stringify(FIXTURE_MANIFEST))!
    expect(findDbtManifestNode(manifest, 'fct_orders')?.uniqueId).toBe('model.demo.fct_orders')
    expect(findDbtManifestNode(manifest, 'source.demo.shop.orders')?.name).toBe('orders')
    expect(findDbtManifestNode(manifest, 'missing')).toBeNull()
    expect(listDbtManifestModels(manifest).map((node) => node.name)).toEqual([
      'fct_orders',
      'stg_orders'
    ])
    expect(listDbtManifestModels(manifest, 'STG').map((node) => node.name)).toEqual(['stg_orders'])
  })

  it('walks lineage both ways, skipping tests and honouring the depth cap', () => {
    const manifest = parseDbtManifest('/m.json', JSON.stringify(FIXTURE_MANIFEST))!
    expect(walkDbtLineage(manifest, 'model.demo.fct_orders', 'upstream', 5)).toEqual([
      { uniqueId: 'model.demo.stg_orders', name: 'stg_orders', resourceType: 'model', depth: 1 },
      { uniqueId: 'source.demo.shop.orders', name: 'orders', resourceType: 'source', depth: 2 }
    ])
    expect(walkDbtLineage(manifest, 'model.demo.fct_orders', 'upstream', 1)).toHaveLength(1)
    expect(walkDbtLineage(manifest, 'model.demo.stg_orders', 'downstream', 5)).toEqual([
      { uniqueId: 'model.demo.fct_orders', name: 'fct_orders', resourceType: 'model', depth: 1 }
    ])
  })
})

describe('loadDbtManifest', () => {
  it('caches by mtime and reloads when the file changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pod-dbt-manifest-'))
    roots.push(dir)
    const project = {
      projectDir: dir,
      projectFile: join(dir, 'dbt_project.yml'),
      name: 'demo',
      modelPaths: ['models'],
      macroPaths: ['macros'],
      targetPath: 'target'
    }
    const file = dbtManifestPath(project)
    expect(loadDbtManifest(file)).toBeNull()
    mkdirSync(join(dir, 'target'))
    writeFileSync(file, JSON.stringify(FIXTURE_MANIFEST))
    utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000))
    const first = loadDbtManifest(file)
    expect(first?.nodes.size).toBe(4)
    expect(loadDbtManifest(file)).toBe(first)
    writeFileSync(file, JSON.stringify({ ...FIXTURE_MANIFEST, sources: {} }))
    utimesSync(file, new Date(1_700_000_001_000), new Date(1_700_000_001_000))
    expect(loadDbtManifest(file)?.nodes.size).toBe(3)
  })
})
