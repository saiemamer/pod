import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { ensureDbtCatalog, exportDbtCsv, resolveDbtRefRequest } from './dbt-artifact-ops'
import { DbtCatalogSessionLedger } from './dbt-catalog-refresh'
import { AeDbtService } from './dbt-service'

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case " $* " in
  *" parse "*) mkdir -p target; printf '{"metadata": {"dbt_version": "1.9.0"}, "nodes": {"model.demo.orders": {"name": "orders", "resource_type": "model", "package_name": "demo", "original_file_path": "models/marts/orders.sql", "path": "marts/orders.sql"}}, "parent_map": {}, "child_map": {}}' > target/manifest.json; exit 0 ;;
  *" docs generate "*) mkdir -p target; printf '{"metadata": {"generated_at": "2026-09-07T14:05:00Z"}, "nodes": {"model.demo.orders": {}}}' > target/catalog.json; exit 0 ;;
esac
exit 1
`

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
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function service(settings: Record<string, unknown> = {}): AeDbtService {
  return new AeDbtService({
    store: {
      getSettings: () => ({ toolCmdOverrides: { dbt: join(root, 'dbt') }, aeDbt: settings })
    } as unknown as Store,
    runtime: {
      showManagedWorktree: async () => {
        throw new Error('selector_not_found')
      }
    } as unknown as OrcaRuntimeService,
    domains: null,
    // Why a real PATH: the stub calls mkdir, which is not a shell builtin.
    env: { PATH: '/usr/bin:/bin', STUB_LOG: log }
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
    expect(first.catalog).toMatchObject({ exists: true, nodeCount: 1 })
    expect(first.manifest).toMatchObject({ exists: true, nodeCount: 1 })
    const second = await ensureDbtCatalog(service(), { path }, ledger)
    expect(second.outcome).toBe('skipped')
    expect(calls()).toHaveLength(2)
    const forced = await ensureDbtCatalog(service(), { path, force: true }, ledger)
    expect(forced.outcome).toBe('refreshed')
    expect(calls()).toHaveLength(4)
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

describe('ref resolution through the service', () => {
  it('uses the manifest to pick between files with the same name', async () => {
    const path = join(project, 'models', 'marts', 'orders.sql')
    await ensureDbtCatalog(service(), { path }, new DbtCatalogSessionLedger())
    const resolved = await resolveDbtRefRequest(service(), { path, name: 'orders' })
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
