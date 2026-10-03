import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildOmniEnv, describeOmniFailure, runOmniJson } from './omni-runner'

let state: string

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'pod-omni-runner-'))
})

afterEach(() => {
  rmSync(state, { recursive: true, force: true })
})

const env = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin',
  POD_OMNI_STUB_STATE: state,
  ...extra
})

describe('runOmniJson', () => {
  it('names the binary when the Settings path points at nothing', async () => {
    await expect(
      runOmniJson({
        binary: join(state, 'missing-omni'),
        args: ['models', 'list'],
        cwd: state,
        env: env({ OMNI_API_KEY: 'k' })
      })
    ).rejects.toThrow(/missing-omni/)
  })
})

describe('the Omni child environment', () => {
  it("keeps a user's own OMNI_API_TOKEN over the domain's OMNI_API_KEY", () => {
    expect(buildOmniEnv({ OMNI_API_KEY: 'domain', OMNI_API_TOKEN: 'mine' }).OMNI_API_TOKEN).toBe(
      'mine'
    )
  })
})

describe('describeOmniFailure', () => {
  it('keeps plain-text usage errors, which an older CLI prints for an unknown flag', () => {
    const message = describeOmniFailure({
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'Error: unknown flag: --branch-id\nUsage:\n  omni models validate <modelId> [flags]',
      timedOut: false,
      durationMs: 5,
      command: 'omni models validate'
    }).message
    expect(message).toContain('unknown flag: --branch-id')
  })
})
