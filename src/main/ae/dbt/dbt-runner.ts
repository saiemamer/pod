import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'

/**
 * Pod: the one place a dbt process is started. Resolves the binary, builds the argument
 * list with the target and profiles directory, and runs it through Orca's child-process
 * chokepoint with a bound on time and output.
 */
export type DbtBinarySource = 'settings' | 'path'

export type DbtBinary = {
  path: string
  source: DbtBinarySource
}

/** Warehouse queries and full parses can take minutes; 30 seconds would cut them off. */
export const DEFAULT_DBT_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_DBT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Where pipx and Homebrew put dbt when the login shell PATH did not reach the main process. */
const FALLBACK_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')]

export function resolveDbtBinary(
  override: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): DbtBinary | null {
  const explicit = override?.trim()
  if (explicit) {
    return { path: explicit, source: 'settings' }
  }
  const found = findOnPath('dbt', env.PATH)
  return found ? { path: found, source: 'path' } : null
}

export function findOnPath(name: string, pathValue: string | undefined): string | null {
  if (isAbsolute(name)) {
    return isExecutable(name) ? name : null
  }
  const dirs = [...(pathValue ?? '').split(delimiter).filter(Boolean), ...FALLBACK_BIN_DIRS]
  for (const dir of dirs) {
    const candidate = join(dir, name)
    if (isExecutable(candidate)) {
      return candidate
    }
  }
  return null
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export type DbtInvocation = {
  binary: string
  projectDir: string
  /** Subcommand and its flags, e.g. ['show', '--select', 'orders', '--limit', '50']. */
  args: readonly string[]
  target?: string
  profilesDir?: string
  /** Complete child environment; defaults to the main process env. */
  env?: NodeJS.ProcessEnv
  /** Off for commands whose answer arrives as an INFO log line (compile). */
  quiet?: boolean
  logFormat?: 'text' | 'json'
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export type DbtRunResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
  durationMs: number
  /** The command line without env, for display and logs. */
  command: string
}

export function buildDbtCommandArgs(invocation: DbtInvocation): string[] {
  const args: string[] = []
  if (invocation.quiet !== false) {
    args.push('--quiet')
  }
  if (invocation.logFormat) {
    args.push('--log-format', invocation.logFormat)
  }
  args.push(...invocation.args)
  if (invocation.target) {
    args.push('--target', invocation.target)
  }
  if (invocation.profilesDir) {
    args.push('--profiles-dir', invocation.profilesDir)
  }
  return args
}

export type DbtRunDeps = {
  run: (spec: ProcessSpec) => Promise<ProcessResult>
  now?: () => number
}

export async function runDbt(
  invocation: DbtInvocation,
  deps: DbtRunDeps = { run: runProcess }
): Promise<DbtRunResult> {
  const args = buildDbtCommandArgs(invocation)
  const command = [basename(invocation.binary), ...args].join(' ')
  const now = deps.now ?? Date.now
  const started = now()
  let result: ProcessResult
  try {
    result = await deps.run({
      program: invocation.binary,
      args,
      cwd: invocation.projectDir,
      // Why: colour codes would land inside the JSON and the compiled SQL we parse.
      env: { ...(invocation.env ?? process.env), DBT_USE_COLORS: 'False', NO_COLOR: '1' },
      timeoutMs: invocation.timeoutMs ?? DEFAULT_DBT_TIMEOUT_MS,
      maxOutputBytes: invocation.maxOutputBytes ?? DEFAULT_DBT_MAX_OUTPUT_BYTES,
      signal: invocation.signal
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: `Could not start ${invocation.binary}: ${message}`,
      timedOut: false,
      truncated: false,
      durationMs: now() - started,
      command
    }
  }
  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    truncated: result.outputTruncated === true,
    durationMs: now() - started,
    command
  }
}

/** One readable line for a failed run: dbt logs errors to stdout, so look there too. */
export function describeDbtFailure(result: DbtRunResult): string {
  if (result.timedOut) {
    return `dbt timed out after ${Math.round(result.durationMs / 1000)}s (${result.command})`
  }
  const text = [result.stderr, result.stdout]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n')
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const tail = lines.slice(-12).join('\n')
  return tail.length > 0
    ? tail
    : `dbt exited with code ${result.code ?? 'unknown'} (${result.command})`
}
