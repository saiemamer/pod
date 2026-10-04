import { basename } from 'node:path'
import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import type { OmniBinary, OmniContextSummary } from '../../../shared/ae/omni-types'
import { findOnPath } from '../dbt/dbt-runner'
import { withOmniDetails } from '../../../shared/ae/omni-error-text'

/**
 * Pod: the one place an Omni CLI process is started. The binary comes from Settings >
 * Analytics Tools or PATH, the env from the domain, and every call asks for JSON.
 */
export const DEFAULT_OMNI_TIMEOUT_MS = 2 * 60_000
export const DEFAULT_OMNI_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export function resolveOmniBinary(
  override: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): OmniBinary | null {
  const explicit = override?.trim()
  if (explicit) {
    return { path: explicit, source: 'settings' }
  }
  const found = findOnPath('omni', env.PATH)
  return found ? { path: found, source: 'path' } : null
}

/** Which env name will authenticate the CLI. Pod's domains name it OMNI_API_KEY; the CLI reads OMNI_API_TOKEN. */
export function omniTokenEnv(env: NodeJS.ProcessEnv): OmniContextSummary['tokenEnv'] {
  if (env.OMNI_API_TOKEN) {
    return 'OMNI_API_TOKEN'
  }
  return env.OMNI_API_KEY ? 'OMNI_API_KEY' : null
}

/** The child env: the caller's env plus the token under the name the CLI reads, quiet and colourless. */
export function buildOmniEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, OMNI_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
  if (!next.OMNI_API_TOKEN && next.OMNI_API_KEY) {
    next.OMNI_API_TOKEN = next.OMNI_API_KEY
  }
  return next
}

export type OmniInvocation = {
  binary: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
}

export type OmniRunResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  command: string
}

export type OmniRunDeps = {
  run: (spec: ProcessSpec) => Promise<ProcessResult>
  now?: () => number
}

/** `message` carries the plain summary and, after a marker, the CLI's own text. */
export class OmniCliError extends Error {
  constructor(
    readonly summary: string,
    readonly status: number | null,
    readonly command: string,
    readonly details = ''
  ) {
    super(withOmniDetails(summary, details))
    this.name = 'OmniCliError'
  }
}

export function buildOmniCommandArgs(args: string[]): string[] {
  // Why: the CLI prints tables on a TTY and JSON when piped; never rely on which it guesses.
  return [...args, '--format', 'json', '--compact']
}

export async function runOmni(
  invocation: OmniInvocation,
  deps: OmniRunDeps = { run: runProcess }
): Promise<OmniRunResult> {
  const args = buildOmniCommandArgs(invocation.args)
  const command = [basename(invocation.binary), ...invocation.args].join(' ')
  const now = deps.now ?? Date.now
  const started = now()
  try {
    const result = await deps.run({
      program: invocation.binary,
      args,
      cwd: invocation.cwd,
      env: buildOmniEnv(invocation.env),
      timeoutMs: invocation.timeoutMs ?? DEFAULT_OMNI_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_OMNI_MAX_OUTPUT_BYTES,
      signal: invocation.signal
    })
    return {
      ok: result.code === 0 && !result.timedOut,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      durationMs: now() - started,
      command
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: `Could not start ${invocation.binary}: ${message}`,
      timedOut: false,
      durationMs: now() - started,
      command
    }
  }
}

/** Runs the command and parses stdout as JSON, or throws with a plain account of what failed. */
export async function runOmniJson(
  invocation: OmniInvocation,
  deps?: OmniRunDeps
): Promise<unknown> {
  const result = await runOmni(invocation, deps)
  if (!result.ok) {
    const failure = describeOmniFailure(result)
    throw new OmniCliError(failure.summary, failure.status, result.command, failure.details)
  }
  const text = result.stdout.trim()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new OmniCliError(
      `Pod ran \`${shortCommand(result.command)}\` and the Omni CLI printed something other than JSON.`,
      null,
      result.command,
      capDetails(`$ ${result.command}\n\n${text}`)
    )
  }
}

export type OmniFailure = { summary: string; status: number | null; details: string }

const OMNI_DETAILS_LIMIT = 4000
const USAGE_ERROR =
  /^(unknown (flag|shorthand flag|command)|accepts \d+ arg|requires at least|invalid argument|flag needs an argument)/

/**
 * Omni CLI 1.0.4 prints `Error: <what>` and then the command's usage on stderr for every
 * failure. An API error also leaves the response body on stdout, and stderr then reads
 * `Error: API returned HTTP <status>`. The summary says what Pod ran and what went wrong;
 * the CLI's text goes into `details`.
 */
export function describeOmniFailure(result: OmniRunResult): OmniFailure {
  const command = shortCommand(result.command)
  const ran = `Pod ran \`${command}\``
  const details = capDetails(
    [`$ ${result.command}`, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n\n')
  )
  if (result.timedOut) {
    return {
      summary: `${ran} and the Omni CLI gave no answer within ${Math.round(result.durationMs / 1000)}s.`,
      status: null,
      details
    }
  }
  if (result.code === null) {
    return {
      summary: `Pod could not start the Omni CLI for \`${command}\`. Check its path in Settings > Analytics Tools.`,
      status: null,
      details
    }
  }
  const cliError = readCliError(result.stderr)
  const statusMatch = /^API returned HTTP (\d{3})$/.exec(cliError)
  if (statusMatch) {
    const status = Number(statusMatch[1])
    return {
      summary: describeHttpFailure(ran, status, readBodyDetail(result.stdout)),
      status,
      details
    }
  }
  if (cliError.startsWith('no API token configured')) {
    return {
      summary: `Pod could not run \`${command}\`: the Omni CLI is not signed in. Run \`omni config init\` in a terminal (it asks for your Omni address, then an API key or a browser sign-in), or add OMNI_API_KEY to the domain's secrets.`,
      status: null,
      details
    }
  }
  if (cliError.startsWith('no API base URL configured')) {
    return {
      summary: `Pod could not run \`${command}\`: the Omni CLI does not know your Omni address. Set OMNI_BASE_URL (for example https://yourcompany.omniapp.co) in Domain settings > Environment, or run \`omni config init\` in a terminal.`,
      status: null,
      details
    }
  }
  if (/^endpoint .* (does not use HTTPS|is not a recognized Omni domain)/.test(cliError)) {
    return {
      summary: `Pod could not run \`${command}\`: the Omni CLI refused to send the token to the Omni address it was given. OMNI_BASE_URL must be an https:// address on omniapp.co.`,
      status: null,
      details
    }
  }
  if (USAGE_ERROR.test(cliError)) {
    return {
      summary: `${ran}, and this Omni CLI does not accept that command (${cliError}). Pod's Omni commands are written for Omni CLI 1.0.4; another version may have renamed them.`,
      status: null,
      details
    }
  }
  return {
    summary: cliError
      ? `${ran} and the Omni CLI failed: ${cliError}`
      : `${ran} and the Omni CLI exited with code ${result.code}.`,
    status: null,
    details
  }
}

function describeHttpFailure(ran: string, status: number, detail: string): string {
  const said = detail ? `: ${detail}` : ''
  if (status === 401) {
    return `Omni did not accept the sign-in when ${ran} (HTTP 401${said}). The token may be wrong or expired: run \`omni config login\` in a terminal, or replace OMNI_API_KEY in the domain's secrets.`
  }
  if (status === 403) {
    return `Omni refused ${ran.replace(/^Pod ran /, '')} for this account (HTTP 403${said}). The token may not have access to this model.`
  }
  return `${ran} and Omni answered HTTP ${status}${said}.`
}

/** The `Error: ...` line cobra prints before the usage. */
function readCliError(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('Error: '))
  return line ? line.slice('Error: '.length).trim() : ''
}

/** The CLI's own pick from an error body: `detail`, then `message`, then `error`. */
function readBodyDetail(stdout: string): string {
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    if (typeof parsed !== 'object' || parsed === null) {
      return ''
    }
    for (const key of ['detail', 'message', 'error']) {
      const value: unknown = Reflect.get(parsed, key)
      if (typeof value === 'string' && value) {
        return value
      }
    }
  } catch {
    // Not JSON: the raw body stays in the details.
  }
  return ''
}

/** Why: ids and request bodies belong in the details, not the summary. */
function shortCommand(command: string): string {
  return command.split(' ').slice(0, 3).join(' ')
}

function capDetails(text: string): string {
  return text.length > OMNI_DETAILS_LIMIT ? `${text.slice(0, OMNI_DETAILS_LIMIT)}\n…` : text
}
