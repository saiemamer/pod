import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  DbtSqlglotSidecar,
  parseSidecarOutput,
  resolvePython,
  SQLGLOT_PROBE_RETRY_MS,
  sqlglotDialectFor
} from './dbt-sqlglot-sidecar'

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

describe('resolvePython', () => {
  it('prefers the settings path and falls back to PATH', () => {
    expect(resolvePython('/venv/bin/python', {})).toEqual({
      path: '/venv/bin/python',
      source: 'settings'
    })
    expect(resolvePython('   ', { PATH: '/nonexistent-dir' })?.source ?? null).toBe(
      resolvePython(undefined, { PATH: '/nonexistent-dir' })?.source ?? null
    )
  })
})

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
    const sidecar = new DbtSqlglotSidecar({ run, now: () => now })
    const first = await sidecar.status('/py', {})
    expect(first).toEqual({
      engine: 'name-match',
      python: '/py',
      pythonSource: 'settings',
      note: "ModuleNotFoundError: No module named 'sqlglot'"
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
