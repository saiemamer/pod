import { existsSync, readdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import type { AeDbtDistribution } from '../../../shared/ae/dbt-settings-types'
import type { AeSetupDbtCandidate } from '../../../shared/ae/setup-types'

/**
 * Pod: find the dbt, omni and Python a laptop actually runs. Every probe is `--version`
 * (or a sqlglot import for Python); nothing here can reach a warehouse or Omni.
 */
export type AeSetupProbeDeps = {
  run: (spec: ProcessSpec) => Promise<ProcessResult>
  /** The login shell's environment: its PATH decides the candidate order. */
  env: NodeJS.ProcessEnv
  home: string | null
}

const PROBE_TIMEOUT_MS = 20_000
const VENV_DIRS = ['.venv', 'venv', 'env'] as const

/** Virtual environments in the repo (and the dbt project folder), then beside the repo. */
function venvBinDirs(dirs: string[]): string[] {
  const roots = [...new Set(dirs.flatMap((dir) => [dir, dirname(dir)]))]
  return roots.flatMap((root) => VENV_DIRS.map((venv) => join(root, venv, 'bin')))
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? '').split(delimiter).filter(Boolean)
}

/** pyenv keeps each Python's own scripts here, which is where a working dbt sits behind a broken shim. */
function pyenvVersionBinDirs(home: string | null): string[] {
  if (!home) {
    return []
  }
  const versions = join(home, '.pyenv', 'versions')
  try {
    return readdirSync(versions).map((version) => join(versions, version, 'bin'))
  } catch {
    return []
  }
}

/** Existing files named `name` across the dirs, in order, without repeats. */
export function toolCandidates(name: string, dirs: string[]): string[] {
  const seen = new Set<string>()
  const found: string[] = []
  for (const dir of dirs) {
    const candidate = join(dir, name)
    if (!seen.has(candidate) && existsSync(candidate)) {
      seen.add(candidate)
      found.push(candidate)
    }
  }
  return found
}

function candidateDirs(repoDirs: string[], deps: AeSetupProbeDeps): string[] {
  const fallback = ['/opt/homebrew/bin', '/usr/local/bin']
  const home = deps.home ? [join(deps.home, '.local', 'bin')] : []
  return [
    ...venvBinDirs(repoDirs),
    ...pathDirs(deps.env),
    ...fallback,
    ...home,
    ...pyenvVersionBinDirs(deps.home)
  ]
}

async function runQuiet(
  deps: AeSetupProbeDeps,
  program: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await deps.run({
      program,
      args,
      env: { ...deps.env, NO_COLOR: '1', DBT_USE_COLORS: 'False' },
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 256 * 1024
    })
    const output = `${result.stdout}\n${result.stderr}`.trim()
    return { ok: result.code === 0 && !result.timedOut, output }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  )
}

export type DbtVersionInfo = { distribution: AeDbtDistribution; version: string | null }

/** Core prints `Core: - installed: 1.9.0`; Fusion prints `dbt-fusion 2.0.0-...`. */
export function parseDbtVersion(output: string): DbtVersionInfo | null {
  if (/dbt[- ]fusion/i.test(output)) {
    const match = /dbt[- ]fusion\s+v?(\S+)/i.exec(output)
    return { distribution: 'fusion', version: match?.[1] ?? null }
  }
  const installed = /installed:\s*(\S+)/i.exec(output)
  if (installed) {
    return { distribution: 'core', version: installed[1] }
  }
  return null
}

export async function probeDbt(
  repoDirs: string[],
  deps: AeSetupProbeDeps
): Promise<{ binary: string | null; info: DbtVersionInfo | null; tried: AeSetupDbtCandidate[] }> {
  const tried: AeSetupDbtCandidate[] = []
  for (const candidate of toolCandidates('dbt', candidateDirs(repoDirs, deps))) {
    const result = await runQuiet(deps, candidate, ['--version'])
    const info = result.ok ? parseDbtVersion(result.output) : null
    if (info) {
      tried.push({ path: candidate, ok: true })
      return { binary: candidate, info, tried }
    }
    tried.push({ path: candidate, ok: false, note: firstLine(result.output) || 'did not run' })
  }
  return { binary: null, info: null, tried }
}

export async function probeOmni(
  deps: AeSetupProbeDeps
): Promise<{ binary: string | null; version: string | null }> {
  for (const candidate of toolCandidates('omni', candidateDirs([], deps))) {
    const result = await runQuiet(deps, candidate, ['--version'])
    if (result.ok) {
      const version = /(\d+\.\d+\.\d+\S*)/.exec(result.output)?.[1] ?? firstLine(result.output)
      return { binary: candidate, version: version || null }
    }
  }
  return { binary: null, version: null }
}

const SQLGLOT_IMPORT = 'import sqlglot; print(sqlglot.__version__)'

export async function probeSqlglotPython(
  repoDirs: string[],
  deps: AeSetupProbeDeps
): Promise<{ path: string | null; sqlglotVersion: string | null }> {
  const dirs = candidateDirs(repoDirs, deps)
  const candidates = [...toolCandidates('python3', dirs), ...toolCandidates('python', dirs)]
  for (const candidate of candidates) {
    const result = await runQuiet(deps, candidate, ['-c', SQLGLOT_IMPORT])
    if (result.ok) {
      return { path: candidate, sqlglotVersion: firstLine(result.output) || null }
    }
  }
  return { path: null, sqlglotVersion: null }
}
