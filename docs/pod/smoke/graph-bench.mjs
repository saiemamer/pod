// Node-side timings for the lineage code on the performance fixture: manifest parse,
// graph build (columns, inheritance), neighbourhood at the node cap, dagre layout, and
// the sqlglot sidecar over a few hundred models. Run with tsx so the TypeScript sources
// load as they are:
//
//   POD_SQLGLOT_PYTHON=/tmp/sqlglot-venv/bin/python npx tsx docs/pod/smoke/graph-bench.mjs
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { parseDbtManifest } from '../../../src/main/ae/dbt/dbt-manifest.ts'
import { parseDbtCatalog } from '../../../src/main/ae/dbt/dbt-catalog.ts'
import {
  buildDbtGraphIndex,
  DbtGraphService,
  readDbtNodeSql
} from '../../../src/main/ae/dbt/dbt-graph.ts'
import { DbtColumnLineageService } from '../../../src/main/ae/dbt/dbt-column-lineage.ts'
import { DbtSqlglotSidecar } from '../../../src/main/ae/dbt/dbt-sqlglot-sidecar.ts'
import { selectDbtNeighbourhood } from '../../../src/shared/ae/dbt-lineage-graph.ts'
import { layoutLineage } from '../../../src/renderer/src/ae/lineage/lineage-layout.ts'

const REPO = process.argv[2] ?? `${process.env.HOME}/Projects/pod-smoke/dbt-demo`
const project = {
  projectDir: REPO,
  projectFile: `${REPO}/dbt_project.yml`,
  name: 'demo',
  modelPaths: ['models'],
  macroPaths: [],
  targetPath: 'target'
}
const ms = (t) => `${t.toFixed(1)} ms`
const time = (label, fn) => {
  const t0 = performance.now()
  const out = fn()
  console.log(label.padEnd(44), ms(performance.now() - t0))
  return out
}

const manifestText = readFileSync(`${REPO}/perf/manifest.json`, 'utf8')
const catalogText = readFileSync(`${REPO}/perf/catalog.json`, 'utf8')
const manifest = time('parse manifest.json', () => parseDbtManifest('m.json', manifestText, 1))
const catalog = time('parse catalog.json', () => parseDbtCatalog('c.json', catalogText, 1))
const index = time('build graph (columns + inheritance)', () =>
  buildDbtGraphIndex(manifest, catalog, (node) => readDbtNodeSql(project, node))
)
console.log('nodes', index.nodes.size)
const hood = time('neighbourhood of orders, depth 4/4, cap 500', () =>
  selectDbtNeighbourhood(index, 'model.demo.orders', {
    upstreamDepth: 4,
    downstreamDepth: 4,
    maxNodes: 500
  })
)
console.log(
  'neighbourhood nodes',
  hood.nodeIds.length,
  'edges',
  hood.edges.length,
  'truncated',
  hood.truncated
)
time(`dagre layout of ${hood.nodeIds.length} nodes with columns`, () =>
  layoutLineage(
    hood.nodeIds.map((id) => ({
      id,
      columnCount: index.nodes.get(id).columns.length,
      showColumns: true
    })),
    hood.edges
  )
)
time(`dagre layout of ${hood.nodeIds.length} nodes, headers only`, () =>
  layoutLineage(
    hood.nodeIds.map((id) => ({ id, columnCount: 0, showColumns: false })),
    hood.edges
  )
)

const python = process.env.POD_SQLGLOT_PYTHON
if (python) {
  const graphService = new DbtGraphService()
  const graph = {
    projectDir: REPO,
    manifestMtimeMs: 1,
    catalogMtimeMs: 1,
    catalogExists: true,
    manifest,
    index
  }
  const columns = new DbtColumnLineageService(new DbtSqlglotSidecar(), graphService.readSql)
  const focus = index.nodes.get('model.demo.orders')
  for (const label of [
    'sqlglot column lineage, cold (spawn + parse)',
    'sqlglot column lineage, warm (cached)'
  ]) {
    const t0 = performance.now()
    const result = await columns.lineage(
      graph,
      project,
      focus,
      { python, env: process.env, dialect: 'bigquery' },
      { path: REPO, model: 'orders', column: 'status' },
      { depth: 4, maxNodes: 500 }
    )
    console.log(
      label.padEnd(44),
      ms(performance.now() - t0),
      `| engine ${result.engine}, ${result.columns.length} lit columns, ${result.nameMatchedNodes.length} name-matched, truncated ${result.truncated}`
    )
  }
} else {
  console.log('set POD_SQLGLOT_PYTHON to time the sidecar')
}
