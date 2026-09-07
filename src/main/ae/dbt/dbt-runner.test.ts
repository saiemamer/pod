import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProcessSpec } from '../../../shared/child-process/process-spec'
import {
  buildDbtCommandArgs,
  describeDbtFailure,
  findOnPath,
  resolveDbtBinary,
  runDbt
} from './dbt-runner'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveDbtBinary', () => {
  it('uses the settings path first, then an executable named dbt on PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'pod-dbt-bin-'))
    roots.push(bin)
    writeFileSync(join(bin, 'dbt'), '#!/bin/sh\n')
    chmodSync(join(bin, 'dbt'), 0o755)
    expect(resolveDbtBinary('/opt/dbt', { PATH: bin })).toEqual({
      path: '/opt/dbt',
      source: 'settings'
    })
    expect(resolveDbtBinary(undefined, { PATH: `/nowhere:${bin}` })).toEqual({
      path: join(bin, 'dbt'),
      source: 'path'
    })
    expect(findOnPath('dbt', '/nowhere')).toBeNull()
    expect(findOnPath(join(bin, 'dbt'), undefined)).toBe(join(bin, 'dbt'))
  })
})

describe('buildDbtCommandArgs', () => {
  it('adds quiet, log format, target and profiles dir around the subcommand', () => {
    expect(
      buildDbtCommandArgs({
        binary: 'dbt',
        projectDir: '/p',
        args: ['show', '--select', 'orders'],
        target: 'dev',
        profilesDir: '/p/local_profiles'
      })
    ).toEqual([
      '--quiet',
      'show',
      '--select',
      'orders',
      '--target',
      'dev',
      '--profiles-dir',
      '/p/local_profiles'
    ])
    expect(
      buildDbtCommandArgs({
        binary: 'dbt',
        projectDir: '/p',
        args: ['compile'],
        quiet: false,
        logFormat: 'json'
      })
    ).toEqual(['--log-format', 'json', 'compile'])
  })
})

describe('runDbt', () => {
  it('runs in the project directory with colours off and reports the outcome', async () => {
    const run = vi.fn(async (spec: ProcessSpec) => {
      expect(spec.cwd).toBe('/p')
      expect(spec.env?.DBT_USE_COLORS).toBe('False')
      expect(spec.env?.SECRET).toBe('kept')
      expect(spec.timeoutMs).toBe(600_000)
      return { code: 0, signal: null, stdout: '{"show": []}', stderr: '', timedOut: false }
    })
    const result = await runDbt(
      { binary: '/usr/local/bin/dbt', projectDir: '/p', args: ['show'], env: { SECRET: 'kept' } },
      { run }
    )
    expect(result).toMatchObject({
      ok: true,
      code: 0,
      stdout: '{"show": []}',
      command: 'dbt --quiet show'
    })
  })

  it('turns a spawn failure into a failed result instead of throwing', async () => {
    const run = vi.fn(async () => {
      throw new Error('ENOENT')
    })
    const result = await runDbt(
      { binary: '/missing/dbt', projectDir: '/p', args: ['parse'] },
      { run }
    )
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('Could not start /missing/dbt')
  })
})

describe('describeDbtFailure', () => {
  it('reports timeouts and otherwise the tail of what dbt printed', () => {
    const base = {
      ok: false,
      code: 2,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      durationMs: 1500,
      command: 'dbt --quiet show'
    }
    expect(describeDbtFailure({ ...base, timedOut: true })).toContain('timed out after 2s')
    expect(describeDbtFailure({ ...base, stdout: 'Compilation Error\n  bad ref' })).toBe(
      'Compilation Error\n  bad ref'
    )
    expect(describeDbtFailure(base)).toBe('dbt exited with code 2 (dbt --quiet show)')
  })
})
