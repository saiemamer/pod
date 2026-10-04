import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  dbtCatalogRunRequest,
  ensureDbtCatalog,
  exportDbtCsv,
  resolveDbtRefRequest
} from './dbt-artifact-ops'
import { DbtCatalogSessionLedger } from './dbt-catalog-refresh'
import { AeDbtService } from './dbt-service'

// STUB_MODE picks a canned docs generate: `denied` writes a catalog with refused datasets
// and exits 1, as dbt Core does; `broken` writes nothing and exits 2.
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case " $* " in
  *" parse "*) mkdir -p target; printf '{"metadata": {"dbt_version": "1.9.0"}, "nodes": {"model.demo.orders": {"name": "orders", "resource_type": "model", "package_name": "demo", "original_file_path": "models/marts/orders.sql", "path": "marts/orders.sql"}}, "parent_map": {}, "child_map": {}}' > target/manifest.json; exit 0 ;;
esac
case "$STUB_MODE" in
  denied) mkdir -p target; cp "$STUB_DIR/denied-catalog.json" target/catalog.json; cat "$STUB_DIR/denied.out"; exit 1 ;;
  broken) cat "$STUB_DIR/broken.out"; exit 2 ;;
esac
case " $* " in
  *" docs generate "*) mkdir -p target; printf '{"metadata": {"generated_at": "2026-09-07T14:05:00Z"}, "nodes": {"model.demo.orders": {}}}' > target/catalog.json; exit 0 ;;
esac
exit 1
`

const WARNINGS = [
  '/venv/lib/python3.11/site-packages/agate/table/from_object.py:21: RuntimeWarning: Error importing babel',
  '  warnings.warn(',
  '/venv/lib/python3.11/site-packages/google/auth/_default.py:76: UserWarning: Your application has authenticated using end user credentials',
  '  warnings.warn(_CLOUD_SDK_CREDENTIALS_WARNING)'
]

const DENIED_CATALOG = JSON.stringify({
  metadata: {},
  nodes: { 'model.demo.orders': {} },
  errors: [
    'Database Error\n  Access Denied: Dataset proj:finance: Permission bigquery.tables.list denied on dataset proj:finance',
    'Database Error\n  Access Denied: Dataset proj:hr: Permission bigquery.tables.list denied'
  ]
})

const DENIED_OUT = [
  ...WARNINGS,
  '12:01:40  Catalog written to /p/target/catalog.json',
  '12:01:40  dbt encountered 2 failures while writing the catalog'
].join('\n')

const BROKEN_OUT = [
  ...WARNINGS,
  '12:00:03  BigQuery adapter: https://console.cloud.google.com/bigquery?project=proj&j=bq:EU:abc',
  '12:00:04  Encountered an error:',
  'Runtime Error',
  '  Database Error in model mart_orders (models/marts/mart_orders.sql)',
  '    Not found: Table proj:dbt_me.stg_orders was not found in location EU',
  ...WARNINGS
].join('\n')

let root: string
let project: string
let log: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-artifacts-'))
  project = join(root, 'repo')
  mkdirSync(join(project, 'models', 'marts'), { recursive: true })
  mkdirSync(join(project, 'models', 'legacy'), { recursive: true })
  writeFileSync(join(project, 'dbt_project.yml'), 'name: demo\nprofile: demo\n')
  writeFileSync(join(project, 'models', 'marts', 'orders.sql'), "select * from {{ ref('stg') }}")
  writeFileSync(join(project, 'models', 'legacy', 'orders.sql'), 'select 1')
  writeFileSync(join(root, 'dbt'), STUB, { flag: 'wx' })
  chmodSync(join(root, 'dbt'), 0o755)
  log = join(root, 'stub.log')
  writeFileSync(join(root, 'denied-catalog.json'), DENIED_CATALOG)
  writeFileSync(join(root, 'denied.out'), DENIED_OUT)
  writeFileSync(join(root, 'broken.out'), BROKEN_OUT)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function service(settings: Record<string, unknown> = {}, mode = ''): AeDbtService {
  return new AeDbtService({
    store: {
      getSettings: () => ({
        toolCmdOverrides: { dbt: join(root, 'dbt') },
        aeDbt: settings
      })
    } as unknown as Store,
    runtime: {
      showManagedWorktree: async () => {
        throw new Error('selector_not_found')
      }
    } as unknown as OrcaRuntimeService,
    domains: null,
    // Why a real PATH: the stub calls mkdir, which is not a shell builtin.
    env: { PATH: '/usr/bin:/bin', STUB_LOG: log, STUB_DIR: root, STUB_MODE: mode }
  })
}

const calls = (): string[] => readFileSync(log, 'utf8').trim().split('\n')

describe('catalog refresh through the service', () => {
  it('runs parse and docs generate once per project per session', async () => {
    const ledger = new DbtCatalogSessionLedger()
    const path = join(project, 'models', 'marts', 'orders.sql')
    const first = await ensureDbtCatalog(service(), { path }, ledger)
    expect(first.outcome).toBe('refreshed')
    expect(first.commands.map((command) => command.split(' ').slice(1, 3).join(' '))).toEqual([
      '--quiet parse',
      '--quiet docs'
    ])
    // Why --no-compile: a compile stops the whole catalog at one model it cannot compile.
    expect(calls()[1]).toContain('docs generate --no-compile')
    expect(first.run?.status).toBe('ok')
    expect(first.catalog).toMatchObject({ exists: true, nodeCount: 1 })
    expect(first.manifest).toMatchObject({ exists: true, nodeCount: 1 })
    const second = await ensureDbtCatalog(service(), { path }, ledger)
    expect(second.outcome).toBe('skipped')
    expect(calls()).toHaveLength(2)
    const forced = await ensureDbtCatalog(service(), { path, force: true }, ledger)
    expect(forced.outcome).toBe('refreshed')
    expect(calls()).toHaveLength(4)
    // Why: a target/ wiped after the refresh (dbt clean, a fresh clone) must be rebuilt.
    rmSync(join(project, 'target'), { recursive: true, force: true })
    const rebuilt = await ensureDbtCatalog(service(), { path }, ledger)
    expect(rebuilt.outcome).toBe('refreshed')
    expect(rebuilt.manifest.exists).toBe(true)
    expect(calls()).toHaveLength(6)
  })

  it('skips when parseOnLoad is off', async () => {
    const result = await ensureDbtCatalog(
      service({ parseOnLoad: false }),
      { path: join(project, 'models', 'marts', 'orders.sql') },
      new DbtCatalogSessionLedger()
    )
    expect(result.outcome).toBe('skipped')
    expect(result.catalog.exists).toBe(false)
  })
})

describe('catalog run outcomes', () => {
  const path = (): string => join(project, 'models', 'marts', 'orders.sql')

  it('treats a catalog written with refused datasets as a result naming them', async () => {
    const result = await ensureDbtCatalog(
      service({}, 'denied'),
      { path: path(), force: true },
      new DbtCatalogSessionLedger()
    )
    expect(result.outcome).toBe('refreshed')
    expect(result.catalog.exists).toBe(true)
    expect(result.run?.status).toBe('partial')
    expect(result.run?.skipped?.map((skip) => skip.dataset)).toEqual(['proj:finance', 'proj:hr'])
    expect(result.run?.skipped?.[0].message).toMatch(/^Access Denied: Dataset proj:finance/)
  })

  it('reports a run that wrote no catalog as a plain error with dbt text kept', async () => {
    const result = await ensureDbtCatalog(
      service({}, 'broken'),
      { path: path(), force: true },
      new DbtCatalogSessionLedger()
    )
    expect(result.outcome).toBe('failed')
    expect(result.catalog.exists).toBe(false)
    const failure = result.run?.failure
    expect(failure?.title).toBe('Stopped at model mart_orders (models/marts/mart_orders.sql)')
    expect(failure?.reason).toBe(
      'Not found: Table proj:dbt_me.stg_orders was not found in location EU'
    )
    expect(failure?.hint).toMatch(/not been built under this target/)
    expect(failure?.details).toContain('Encountered an error:')
    // Why: dozens of agate and google-auth warnings once buried the one line that mattered.
    for (const text of [failure?.title, failure?.reason, failure?.details]) {
      expect(text).not.toMatch(/Warning|warnings\.warn/)
    }
  })

  it('keeps the last outcome for the session and waits for a run in flight', async () => {
    const ledger = new DbtCatalogSessionLedger()
    expect(await dbtCatalogRunRequest(service(), { path: path() }, ledger)).toBeNull()
    const running = ensureDbtCatalog(service({}, 'broken'), { path: path(), force: true }, ledger)
    const waited = await dbtCatalogRunRequest(service(), { path: path(), wait: true }, ledger)
    expect(waited?.status).toBe('failed')
    await running
    expect(await dbtCatalogRunRequest(service(), { path: path() }, ledger)).toEqual(waited)
    // The automatic run does not go back to the warehouse after a failure this session.
    const automatic = await ensureDbtCatalog(service({}, 'broken'), { path: path() }, ledger)
    expect(automatic.outcome).toBe('skipped')
    expect(automatic.run?.status).toBe('failed')
  })
})

describe('ref resolution through the service', () => {
  it('uses the manifest to pick between files with the same name', async () => {
    const path = join(project, 'models', 'marts', 'orders.sql')
    await ensureDbtCatalog(service(), { path }, new DbtCatalogSessionLedger())
    const resolved = await resolveDbtRefRequest(service(), {
      path,
      name: 'orders'
    })
    expect(resolved.file).toBe(join(project, 'models', 'marts', 'orders.sql'))
    expect(resolved.alternatives).toEqual([join(project, 'models', 'legacy', 'orders.sql')])
  })
})

describe('CSV export through the service', () => {
  it('writes into the project target directory', async () => {
    const result = await exportDbtCsv(service(), {
      path: join(project, 'models', 'marts', 'orders.sql'),
      label: 'orders',
      columns: ['id'],
      rows: [[1]]
    })
    expect(result.file).toBe(join(project, 'target', 'orders_results.csv'))
    expect(readFileSync(result.file, 'utf8')).toBe('id\r\n1\r\n')
  })
})
