import { describe, expect, it } from 'vitest'
import type { DbtCatalogTree } from '../../../../shared/ae/dbt-graph-types'
import { defaultExpandedRows, flattenCatalogTree } from './pod-dbt-explorer-tree'

const tree: DbtCatalogTree = {
  projectDir: '/p',
  file: '/p/target/catalog.json',
  exists: true,
  relationCount: 3,
  databases: [
    {
      name: 'proj',
      schemas: [
        {
          name: 'dbt',
          relations: [
            {
              name: 'orders',
              type: 'table',
              uniqueId: 'model.demo.orders',
              resourceType: 'model',
              path: 'models/orders.sql',
              columns: [
                { name: 'order_id', type: 'INT64', index: 1 },
                { name: 'status', type: 'STRING', index: 2 }
              ]
            },
            {
              name: 'customers',
              type: 'view',
              uniqueId: 'model.demo.customers',
              resourceType: 'model',
              columns: [{ name: 'customer_id', type: 'INT64', index: 1 }]
            }
          ]
        },
        {
          name: 'raw',
          relations: [
            {
              name: 'events',
              uniqueId: 'source.demo.raw.events',
              resourceType: 'source',
              columns: []
            }
          ]
        }
      ]
    }
  ]
}

describe('flattenCatalogTree', () => {
  it('opens databases and schemas by default and keeps relations closed', () => {
    const rows = flattenCatalogTree(tree, defaultExpandedRows(tree), '')
    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual([
      'database:proj',
      'schema:dbt',
      'relation:orders',
      'relation:customers',
      'schema:raw',
      'relation:events'
    ])
    expect(rows[2]).toMatchObject({
      expandable: true,
      expanded: false,
      meta: 'table'
    })
    expect(rows[5]).toMatchObject({ expandable: false, meta: 'source' })
  })

  it('lists columns under an expanded relation', () => {
    const rows = flattenCatalogTree(
      tree,
      new Set([...defaultExpandedRows(tree), 'model.demo.orders']),
      ''
    )
    expect(rows.map((row) => row.label)).toEqual([
      'proj',
      'dbt',
      'orders',
      'order_id',
      'status',
      'customers',
      'raw',
      'events'
    ])
    expect(rows[3]).toMatchObject({ kind: 'column', depth: 3, meta: 'INT64' })
  })

  it('filters by relation or column name and opens the path to a column hit', () => {
    const byColumn = flattenCatalogTree(tree, new Set(), 'status')
    expect(byColumn.map((row) => row.label)).toEqual(['proj', 'dbt', 'orders', 'status'])
    const byRelation = flattenCatalogTree(tree, new Set(), 'cust')
    expect(byRelation.map((row) => row.label)).toEqual(['proj', 'dbt', 'customers'])
    expect(flattenCatalogTree(tree, new Set(), 'zzz')).toEqual([])
  })
})
