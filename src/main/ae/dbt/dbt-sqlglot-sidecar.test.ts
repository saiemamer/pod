import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  DbtSqlglotSidecar,
  NO_PYTHON_NOTE,
  parseSidecarOutput,
  SQLGLOT_PROBE_RETRY_MS,
  sqlglotDialectFor
} from './dbt-sqlglot-sidecar'
import { findSqlglotBundle, type SqlglotPythonCandidate } from './dbt-sqlglot-python'

function result(partial: Partial<ProcessResult>): ProcessResult {
  return {
    code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...partial
  }
}

describe('sqlglotDialectFor', () => {
  it('maps dbt adapters to sqlglot dialects', () => {
    expect(sqlglotDialectFor('bigquery')).toBe('bigquery')
    expect(sqlglotDialectFor('SQLServer')).toBe('tsql')
    expect(sqlglotDialectFor('exasol')).toBe('exasol')
  })
})

const settingsPython = (): SqlglotPythonCandidate[] => [{ path: '/py', source: 'settings' }]

describe('parseSidecarOutput', () => {
  it('takes the last JSON line and ignores warnings before it', () => {
    expect(
      parseSidecarOutput('DeprecationWarning: x\n{"ok": true, "sqlglot": "1", "nodes": {}}\n')
    ).toEqual({
      ok: true,
      sqlglot: '1',
      nodes: {}
    })
    expect(parseSidecarOutput('nothing here')).toBeNull()
    expect(parseSidecarOutput('{"broken":')).toBeNull()
  })
})

describe('DbtSqlglotSidecar', () => {
  it('probes once per python, caches success, and retries failure after a while', async () => {
    let now = 1000
    const run = vi.fn(async (spec: ProcessSpec) => {
      if (spec.args?.[1]?.includes('__version__')) {
        return run.mock.calls.length === 1
          ? result({
              code: 1,
              stderr: "ModuleNotFoundError: No module named 'sqlglot'"
            })
          : result({ stdout: '30.18.0' })
      }
      return result({ stdout: '{}' })
    })
    const sidecar = new DbtSqlglotSidecar({ run, now: () => now, findPythons: settingsPython })
    const first = await sidecar.status('/py', {})
    expect(first).toEqual({
      engine: 'name-match',
      python: '/py',
      pythonSource: 'settings',
      note: "/py could not run sqlglot: ModuleNotFoundError: No module named 'sqlglot'"
    })
    expect(await sidecar.status('/py', {})).toBe(first)
    now += SQLGLOT_PROBE_RETRY_MS + 1
    const second = await sidecar.status('/py', {})
    expect(second).toEqual({
      engine: 'sqlglot',
      python: '/py',
      pythonSource: 'settings',
      sqlglotVersion: '30.18.0'
    })
    expect(await sidecar.status('/py', {})).toBe(second)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('says plainly when no Python exists, and probes nothing', async () => {
    const run = vi.fn(async () => result({}))
    const sidecar = new DbtSqlglotSidecar({ run, findPythons: () => [] })
    expect(await sidecar.status(undefined, {}, '/fusion/dbt')).toEqual({
      engine: 'name-match',
      noPython: true,
      note: NO_PYTHON_NOTE
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('starts the probe and the analysis with the bundled sqlglot first on PYTHONPATH', async () => {
    const specs: ProcessSpec[] = []
    const run = vi.fn(async (spec: ProcessSpec) => {
      specs.push(spec)
      return spec.args?.[1]?.includes('__version__')
        ? result({ stdout: '30.21.0' })
        : result({ stdout: '{"ok": true, "sqlglot": "30.21.0", "nodes": {}}' })
    })
    const bundle = { dir: '/app/resources/pod-sqlglot', pycacheDir: '/data/sqlglot-pycache' }
    const sidecar = new DbtSqlglotSidecar({ run, bundle, findPythons: settingsPython })
    const status = await sidecar.status(undefined, { PYTHONPATH: '/mine', HOME: '/h' })
    expect(status).toMatchObject({ engine: 'sqlglot', sqlglotVersion: '30.21.0' })
    await sidecar.analyse('/py', { PYTHONPATH: '/mine', HOME: '/h' }, 'bigquery', [
      { id: 'x', sql: 'select 1', schema: {} }
    ])
    expect(specs).toHaveLength(2)
    for (const spec of specs) {
      expect(spec.cwd).toBe(bundle.dir)
      expect(spec.env).toMatchObject({
        HOME: '/h',
        PYTHONPYCACHEPREFIX: bundle.pycacheDir
      })
      expect(spec.env?.PYTHONPATH?.startsWith(bundle.dir)).toBe(true)
      expect(spec.env?.PYTHONPATH?.endsWith('/mine')).toBe(true)
    }
  })

  it('sends the script through -c and the nodes on stdin', async () => {
    const run = vi.fn(async (spec: ProcessSpec) => {
      expect(spec.program).toBe('/py')
      expect(spec.args?.[0]).toBe('-c')
      expect(spec.args?.[1]).toContain('def analyse(')
      expect(JSON.parse(spec.input ?? '')).toEqual({
        dialect: 'bigquery',
        nodes: [{ id: 'model.a', sql: 'select 1', schema: {} }]
      })
      return result({
        stdout:
          '{"ok": true, "sqlglot": "30", "nodes": {"model.a": {"ok": true, "outputs": [], "columns": {}}}}'
      })
    })
    const sidecar = new DbtSqlglotSidecar({ run })
    const output = await sidecar.analyse('/py', {}, 'bigquery', [
      { id: 'model.a', sql: 'select 1', schema: {} }
    ])
    expect(output).toEqual({
      ok: true,
      sqlglot: '30',
      nodes: { 'model.a': { ok: true, outputs: [], columns: {} } }
    })
    expect(await sidecar.analyse('/py', {}, 'bigquery', [])).toEqual({
      ok: true,
      sqlglot: '',
      nodes: {}
    })
  })

  it('reports a crash and a timeout as errors', async () => {
    const crash = new DbtSqlglotSidecar({
      run: async () => result({ code: 1, stderr: 'Traceback\nKeyError: id' })
    })
    expect(await crash.analyse('/py', {}, 'bigquery', [{ id: 'x', sql: '', schema: {} }])).toEqual({
      ok: false,
      error: 'Traceback\nKeyError: id'
    })
    const slow = new DbtSqlglotSidecar({
      run: async () => result({ code: null, timedOut: true })
    })
    expect(
      (await slow.analyse('/py', {}, 'bigquery', [{ id: 'x', sql: '', schema: {} }])) as {
        error?: string
      }
    ).toMatchObject({ ok: false, error: expect.stringContaining('timed out') })
  })
})

// Why gated: it starts a real Python (any 3.9+; the bundled sqlglot comes first on PYTHONPATH).
const realPython = process.env.POD_SQLGLOT_PYTHON
describe.skipIf(!realPython)('the real sidecar on wide models', () => {
  // Why: lineage() re-qualified a 500-column select * once per column, about 30 s per model,
  // so a wide staging chain hit the 60 s timeout and fell back to name matching.
  it('answers a chain of 500-column select * models within seconds', async () => {
    const columns = Array.from({ length: 500 }, (_, i) => `col_${i}`)
    const bundle = findSqlglotBundle(
      resolve(__dirname, '../../../..'),
      mkdtempSync(join(tmpdir(), 'pod-sqlglot-'))
    )
    const sidecar = new DbtSqlglotSidecar({ run: runProcess, bundle })
    const output = await sidecar.analyse(realPython ?? 'python3', process.env, 'bigquery', [
      {
        id: 'model.demo.events_base',
        sql: 'select * from `proj`.`raw`.`events`',
        schema: { 'proj.raw.events': columns }
      },
      {
        id: 'model.demo.events_enriched',
        sql: 'select *, upper(col_1) as col_1_upper from `proj`.`dbt`.`events_base`',
        schema: { 'proj.dbt.events_base': columns }
      },
      {
        id: 'model.demo.fct_events',
        sql: 'select e.col_300 as picked, e.* from `proj`.`dbt`.`events_base` as e',
        schema: { 'proj.dbt.events_base': columns }
      }
    ])

    expect(output.ok).toBe(true)
    const nodes = output.ok ? output.nodes : {}
    const columnsOf = (id: string) => {
      const node = nodes[id]
      return node?.ok ? node.columns : {}
    }
    expect(columnsOf('model.demo.events_base').col_300).toEqual([
      { relation: 'proj.raw.events', column: 'col_300' }
    ])
    expect(columnsOf('model.demo.events_enriched').col_1_upper).toEqual([
      { relation: 'proj.dbt.events_base', column: 'col_1' }
    ])
    expect(columnsOf('model.demo.fct_events').picked).toEqual([
      { relation: 'proj.dbt.events_base', column: 'col_300' }
    ])
  }, 20_000)
})
