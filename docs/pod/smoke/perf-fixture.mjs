// Builds a large dbt project fixture for performance runs: a layered DAG of sources,
// staging, intermediate, mart and report models with columns, plus SQL files so the
// sqlglot sidecar has real work. The smoke repo's own models (orders, stg_orders,
// order_summary, orders_by_customer) are woven in so an editor on orders.sql lands in a
// neighbourhood of hundreds of nodes. Writes manifest.json, catalog.json and the SQL.
//
//   node docs/pod/smoke/perf-fixture.mjs [repo] [models]   (defaults: ~/Projects/pod-smoke/dbt-demo, 1000)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.argv[2] ?? `${process.env.HOME}/Projects/pod-smoke/dbt-demo`
const TOTAL = Number(process.argv[3] ?? 1000)
const OUT = join(REPO, 'perf')
const SQL_DIR = join(REPO, 'models', 'perf')
rmSync(OUT, { recursive: true, force: true })
rmSync(SQL_DIR, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(SQL_DIR, { recursive: true })

// Why these shares: roughly what a warehouse project looks like once it has a few hundred models.
const layers = [
  { name: 'src', share: 0.06, kind: 'source' },
  { name: 'stg', share: 0.24, kind: 'view' },
  { name: 'int', share: 0.34, kind: 'ephemeral' },
  { name: 'mart', share: 0.28, kind: 'table' },
  { name: 'rpt', share: 0.08, kind: 'incremental' }
]
let seed = 42
const rand = () => {
  // Why a fixed generator: the same fixture on every run makes numbers comparable.
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = (list, n) => {
  const out = new Set()
  while (out.size < Math.min(n, list.length)) {
    out.add(list[Math.floor(rand() * list.length)])
  }
  return [...out]
}
const columnPool = [
  'id',
  'customer_id',
  'order_id',
  'status',
  'amount',
  'created_at',
  'updated_at',
  'country',
  'channel',
  'currency',
  'is_test',
  'net_amount',
  'fee',
  'category',
  'region',
  'segment',
  'score',
  'count_items',
  'first_seen_at',
  'last_seen_at'
]

const nodes = {}
const sources = {}
const parentMap = {}
const childMap = {}
const catalogNodes = {}
const catalogSources = {}
const byLayer = []
let made = 0
for (const [index, layer] of layers.entries()) {
  const count = index === layers.length - 1 ? TOTAL - made : Math.round(TOTAL * layer.share)
  made += count
  const ids = []
  for (let i = 0; i < count; i += 1) {
    const name = `${layer.name}_${String(i).padStart(4, '0')}`
    const columns = pick(columnPool, 6 + Math.floor(rand() * 10))
    if (layer.kind === 'source') {
      const id = `source.demo.raw.${name}`
      sources[id] = {
        name,
        resource_type: 'source',
        package_name: 'demo',
        path: 'models/sources.yml',
        original_file_path: 'models/sources.yml',
        database: 'proj',
        schema: 'raw',
        identifier: name,
        relation_name: `\`proj\`.\`raw\`.\`${name}\``,
        columns: Object.fromEntries(columns.map((c) => [c, { name: c, data_type: 'STRING' }]))
      }
      catalogSources[id] = {
        metadata: { type: 'table', schema: 'raw', name, database: 'proj' },
        columns: Object.fromEntries(
          columns.map((c, k) => [c, { type: 'STRING', index: k + 1, name: c }])
        )
      }
      parentMap[id] = []
      ids.push(id)
      continue
    }
    const id = `model.demo.${name}`
    const parents = pick(byLayer[index - 1], 1 + Math.floor(rand() * 3))
    const refs = parents.map((p) => {
      const node = nodes[p] ?? sources[p]
      return p.startsWith('source.')
        ? `{{ source('raw', '${node.name}') }}`
        : `{{ ref('${node.name}') }}`
    })
    const sql = `select ${columns.map((c, k) => (k === 0 ? c : `${c}`)).join(', ')} from ${refs[0]} as a${refs
      .slice(1)
      .map((r, k) => ` left join ${r} as j${k} using (id)`)
      .join('')}\n`
    writeFileSync(join(SQL_DIR, `${name}.sql`), sql)
    nodes[id] = {
      name,
      resource_type: 'model',
      package_name: 'demo',
      path: `perf/${name}.sql`,
      original_file_path: `models/perf/${name}.sql`,
      database: 'proj',
      schema: 'dbt',
      alias: name,
      relation_name: `\`proj\`.\`dbt\`.\`${name}\``,
      config: { materialized: layer.kind },
      depends_on: { nodes: parents }
    }
    catalogNodes[id] = {
      metadata: {
        type: layer.kind === 'view' ? 'view' : 'table',
        schema: 'dbt',
        name,
        database: 'proj'
      },
      columns: Object.fromEntries(
        columns.map((c, k) => [c, { type: 'STRING', index: k + 1, name: c }])
      )
    }
    parentMap[id] = parents
    ids.push(id)
  }
  byLayer.push(ids)
}

// The smoke repo's real models: orders sits between the staging and mart layers.
const real = {
  'model.demo.stg_orders': {
    name: 'stg_orders',
    resource_type: 'model',
    package_name: 'demo',
    path: 'stg_orders.sql',
    original_file_path: 'models/stg_orders.sql',
    database: 'proj',
    schema: 'dbt',
    alias: 'stg_orders',
    relation_name: '`proj`.`dbt`.`stg_orders`',
    config: { materialized: 'view' },
    depends_on: { nodes: ['source.demo.raw.orders', ...pick(byLayer[0], 3)] }
  },
  'model.demo.orders': {
    name: 'orders',
    resource_type: 'model',
    package_name: 'demo',
    path: 'marts/orders.sql',
    original_file_path: 'models/marts/orders.sql',
    database: 'proj',
    schema: 'dbt',
    alias: 'orders',
    relation_name: '`proj`.`dbt`.`orders`',
    config: { materialized: 'table' },
    depends_on: { nodes: ['model.demo.stg_orders', ...pick(byLayer[1], 4), ...pick(byLayer[2], 3)] }
  },
  'model.demo.order_summary': {
    name: 'order_summary',
    resource_type: 'model',
    package_name: 'demo',
    path: 'marts/order_summary.sql',
    original_file_path: 'models/marts/order_summary.sql',
    database: 'proj',
    schema: 'dbt',
    alias: 'order_summary',
    relation_name: '`proj`.`dbt`.`order_summary`',
    config: { materialized: 'incremental' },
    depends_on: { nodes: ['model.demo.orders'] }
  },
  'model.demo.orders_by_customer': {
    name: 'orders_by_customer',
    resource_type: 'model',
    package_name: 'demo',
    path: 'marts/orders_by_customer.sql',
    original_file_path: 'models/marts/orders_by_customer.sql',
    database: 'proj',
    schema: 'dbt',
    alias: 'orders_by_customer',
    relation_name: '`proj`.`dbt`.`orders_by_customer`',
    config: { materialized: 'view' },
    depends_on: { nodes: ['model.demo.stg_orders'] }
  }
}
Object.assign(nodes, real)
sources['source.demo.raw.orders'] = {
  name: 'orders',
  resource_type: 'source',
  package_name: 'demo',
  path: 'models/sources.yml',
  original_file_path: 'models/sources.yml',
  database: 'proj',
  schema: 'raw',
  identifier: 'orders_raw',
  relation_name: '`proj`.`raw`.`orders_raw`',
  columns: {
    id: { name: 'id', data_type: 'INT64' },
    status: { name: 'status', data_type: 'STRING' },
    amount: { name: 'amount', data_type: 'FLOAT64' }
  }
}
for (const [id, node] of Object.entries(real)) {
  parentMap[id] = node.depends_on.nodes
}
parentMap['source.demo.raw.orders'] = []
// Why many children: orders must fan out, so mart and report models depend on it.
for (const id of pick([...byLayer[3], ...byLayer[4]], 40)) {
  nodes[id].depends_on.nodes.push('model.demo.orders')
  parentMap[id].push('model.demo.orders')
}
const cols = (list) =>
  Object.fromEntries(
    list.map((c, k) => [c, { type: k === 0 ? 'INT64' : 'STRING', index: k + 1, name: c }])
  )
catalogNodes['model.demo.stg_orders'] = {
  metadata: { type: 'view', schema: 'dbt', name: 'stg_orders', database: 'proj' },
  columns: cols(['order_id', 'status', 'amount'])
}
catalogNodes['model.demo.orders'] = {
  metadata: { type: 'table', schema: 'dbt', name: 'orders', database: 'proj' },
  columns: cols(['order_id', 'status', 'amount'])
}
catalogNodes['model.demo.order_summary'] = {
  metadata: { type: 'table', schema: 'dbt', name: 'order_summary', database: 'proj' },
  columns: cols(['status', 'n'])
}
catalogNodes['model.demo.orders_by_customer'] = {
  metadata: { type: 'view', schema: 'dbt', name: 'orders_by_customer', database: 'proj' },
  columns: cols(['order_id', 'status', 'amount'])
}
catalogSources['source.demo.raw.orders'] = {
  metadata: { type: 'table', schema: 'raw', name: 'orders_raw', database: 'proj' },
  columns: cols(['id', 'status', 'amount'])
}

for (const [child, parents] of Object.entries(parentMap)) {
  childMap[child] ??= []
  for (const parent of parents) {
    ;(childMap[parent] ??= []).push(child)
  }
}
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({
    metadata: { dbt_version: '1.9.0', generated_at: '2026-09-08T00:00:00Z', project_name: 'demo' },
    nodes,
    sources,
    parent_map: parentMap,
    child_map: childMap
  })
)
writeFileSync(
  join(OUT, 'catalog.json'),
  JSON.stringify({
    metadata: { generated_at: '2026-09-08T00:00:00Z', dbt_version: '1.9.0' },
    nodes: catalogNodes,
    sources: catalogSources
  })
)
const modelCount = Object.keys(nodes).length
const sourceCount = Object.keys(sources).length
console.log(
  `wrote ${modelCount} models, ${sourceCount} sources, ${Object.values(parentMap).flat().length} edges to ${OUT}; SQL under ${SQL_DIR}`
)
