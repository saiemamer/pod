import { basename } from 'node:path'
import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import type { OmniBinary, OmniContextSummary } from '../../../shared/ae/omni-types'
import { findOnPath } from '../dbt/dbt-runner'

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

export class OmniCliError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly command: string
  ) {
    super(message)
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

/** Runs the command and parses stdout as JSON, or throws with the CLI's own error message. */
export async function runOmniJson(
  invocation: OmniInvocation,
  deps?: OmniRunDeps
): Promise<unknown> {
  const result = await runOmni(invocation, deps)
  if (!result.ok) {
    const failure = describeOmniFailure(result)
    throw new OmniCliError(failure.message, failure.status, result.command)
  }
  const text = result.stdout.trim()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new OmniCliError(
      `omni printed something other than JSON (${result.command})`,
      null,
      result.command
    )
  }
}

/**
 * A failed API call leaves one JSON document on stderr, `{"error", "status", "body"}`;
 * a usage error leaves plain text. Either way the message names what went wrong.
 */
export function describeOmniFailure(result: OmniRunResult): {
  message: string
  status: number | null
} {
  if (result.timedOut) {
    return {
      message: `omni timed out after ${Math.round(result.durationMs / 1000)}s (${result.command})`,
      status: null
    }
  }
  const stderr = result.stderr.trim()
  const envelope = parseErrorEnvelope(stderr)
  if (envelope) {
    return envelope
  }
  const lines = stderr.split('\n').filter((line) => line.trim().length > 0)
  const tail = lines.slice(0, 6).join('\n')
  return {
    message: tail || `omni exited with code ${result.code ?? 'unknown'} (${result.command})`,
    status: null
  }
}

function parseErrorEnvelope(text: string): { message: string; status: number | null } | null {
  if (!text.startsWith('{')) {
    return null
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const status = typeof parsed.status === 'number' ? parsed.status : null
    const body = parsed.body as Record<string, unknown> | undefined
    const detail =
      (typeof body?.detail === 'string' && body.detail) ||
      (typeof body?.message === 'string' && body.message) ||
      (typeof parsed.error === 'string' && parsed.error) ||
      ''
    if (!detail) {
      return null
    }
    return { message: status ? `Omni API ${status}: ${detail}` : detail, status }
  } catch {
    return null
  }
}
