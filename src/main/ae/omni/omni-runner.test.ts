import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { splitOmniDetails } from '../../../shared/ae/omni-error-text'
import {
  buildOmniEnv,
  describeOmniFailure,
  OmniCliError,
  runOmniJson,
  type OmniRunResult
} from './omni-runner'

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
    ).rejects.toThrow(/Pod could not start the Omni CLI[\s\S]*missing-omni/)
  })
})

describe('the Omni child environment', () => {
  it("keeps a user's own OMNI_API_TOKEN over the domain's OMNI_API_KEY", () => {
    expect(buildOmniEnv({ OMNI_API_KEY: 'domain', OMNI_API_TOKEN: 'mine' }).OMNI_API_TOKEN).toBe(
      'mine'
    )
  })
})

const failed = (stderr: string, stdout = ''): OmniRunResult => ({
  ok: false,
  code: 1,
  stdout,
  stderr,
  timedOut: false,
  durationMs: 5,
  command: 'omni models list --pagesize 100'
})

// The stderr Omni CLI 1.0.4 prints: `Error: ...`, then the command's usage.
const usage =
  '\nUsage:\n  omni models list [flags]\n\nFlags:\n      --pagesize string   Number of results per page\n'

describe('describeOmniFailure', () => {
  it('says what Pod ran and keeps the usage dump out of the summary', () => {
    const failure = describeOmniFailure(failed(`Error: unknown flag: --page-size${usage}`))
    expect(failure.summary).toBe(
      "Pod ran `omni models list`, and this Omni CLI does not accept that command (unknown flag: --page-size). Pod's Omni commands are written for Omni CLI 1.0.4; another version may have renamed them."
    )
    expect(failure.details).toContain('$ omni models list --pagesize 100')
    expect(failure.details).toContain('--pagesize string')
  })

  it('names a CLI that is not signed in and how to sign in', () => {
    const failure = describeOmniFailure(
      failed(
        `Error: no API token configured. Set OMNI_API_TOKEN, use --token, or run \`omni config init\`${usage}`
      )
    )
    expect(failure.summary).toMatch(
      /^Pod could not run `omni models list`: the Omni CLI is not signed in\./
    )
    expect(failure.summary).toContain('omni config init')
    expect(failure.summary).toContain('OMNI_API_KEY')
  })

  it('names a missing Omni address', () => {
    expect(
      describeOmniFailure(
        failed(
          `Error: no API base URL configured. Set OMNI_BASE_URL, use --base-url, or run \`omni config init\`${usage}`
        )
      ).summary
    ).toContain('Set OMNI_BASE_URL')
  })

  it('reads an API error from the body on stdout and the status on stderr', () => {
    const rejected = describeOmniFailure(
      failed(`Error: API returned HTTP 401${usage}`, '{"detail":"Invalid API key"}')
    )
    expect(rejected.status).toBe(401)
    expect(rejected.summary).toMatch(
      /^Omni did not accept the sign-in when Pod ran `omni models list` \(HTTP 401: Invalid API key\)/
    )
    expect(rejected.summary).toContain('omni config login')
    const missing = describeOmniFailure(
      failed(`Error: API returned HTTP 404${usage}`, '{\n  "message": "Model not found"\n}')
    )
    expect(missing.summary).toBe(
      'Pod ran `omni models list` and Omni answered HTTP 404: Model not found.'
    )
  })

  it('carries the details through the error message, behind the marker', () => {
    const error = new OmniCliError(
      'Pod ran `omni models list` and it failed.',
      null,
      'omni models list',
      'raw'
    )
    expect(splitOmniDetails(`OmniCliError: ${error.message}`)).toEqual({
      summary: 'Pod ran `omni models list` and it failed.',
      details: 'raw'
    })
  })
})
