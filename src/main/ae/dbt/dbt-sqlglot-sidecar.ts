import { runProcess } from '../../../shared/child-process/run-process'
import type { ProcessResult, ProcessSpec } from '../../../shared/child-process/process-spec'
import type { DbtLineageEngineStatus } from '../../../shared/ae/dbt-graph-types'
import { findOnPath } from './dbt-runner'
import { SQLGLOT_LINEAGE_SCRIPT } from './sqlglot-lineage-script'

/**
 * Pod: runs sqlglot in the user's Python for column lineage. The script travels as a
 * `-c` argument (a string constant, so no bundler needs a loader) and the models as JSON
 * on stdin, so nothing is written to disk and no resource has to be packaged. sqlglot is never bundled: it is MIT, but it is the
 * user's interpreter, found through Settings > Analytics Tools or PATH.
 */
export type SqlglotNodeInput = {
  id: string
  sql: string
  /** Relation name as the SQL spells it, to its column names. */
  schema: Record<string, string[]>
}

export type SqlglotColumnRef = { relation: string; column: string }

export type SqlglotNodeOutput =
  | {
      ok: true
      outputs: string[]
      columns: Record<string, SqlglotColumnRef[]>
      errors?: Record<string, string>
    }
  | { ok: false; error: string }

export type SqlglotOutput =
  | { ok: true; sqlglot: string; nodes: Record<string, SqlglotNodeOutput> }
  | { ok: false; error: string }

export type DbtSqlglotSidecarDeps = {
  run: (spec: ProcessSpec) => Promise<ProcessResult>
  now?: () => number
}

export const SQLGLOT_PROBE_TIMEOUT_MS = 20_000
export const SQLGLOT_RUN_TIMEOUT_MS = 60_000
/** A failed probe is tried again after this long, so installing sqlglot needs no restart. */
export const SQLGLOT_PROBE_RETRY_MS = 30_000

/** dbt adapter names to sqlglot dialects; unknown adapters pass through by name. */
export function sqlglotDialectFor(adapter: string): string {
  const map: Record<string, string> = {
    bigquery: 'bigquery',
    snowflake: 'snowflake',
    postgres: 'postgres',
    redshift: 'redshift',
    databricks: 'databricks',
    spark: 'spark',
    duckdb: 'duckdb',
    trino: 'trino',
    athena: 'athena',
    clickhouse: 'clickhouse',
    mysql: 'mysql',
    sqlserver: 'tsql',
    fabric: 'tsql',
    synapse: 'tsql'
  }
  return map[adapter.toLowerCase()] ?? adapter.toLowerCase()
}

export function resolvePython(
  override: string | undefined,
  env: NodeJS.ProcessEnv
): { path: string; source: 'settings' | 'path' } | null {
  const explicit = override?.trim()
  if (explicit) {
    return { path: explicit, source: 'settings' }
  }
  const found = findOnPath('python3', env.PATH) ?? findOnPath('python', env.PATH)
  return found ? { path: found, source: 'path' } : null
}

type ProbeEntry = { status: DbtLineageEngineStatus; at: number }

export class DbtSqlglotSidecar {
  private readonly probes = new Map<string, Promise<ProbeEntry>>()

  constructor(private readonly deps: DbtSqlglotSidecarDeps = { run: runProcess }) {}

  /** Which engine will answer, and why, for the Connection tab and the CLI. */
  async status(
    override: string | undefined,
    env: NodeJS.ProcessEnv
  ): Promise<DbtLineageEngineStatus> {
    const python = resolvePython(override, env)
    if (!python) {
      return {
        engine: 'name-match',
        note: 'No python3 on PATH; set one in Settings > Analytics Tools for sqlglot lineage.'
      }
    }
    const now = this.deps.now ?? Date.now
    const cached = this.probes.get(python.path)
    if (cached) {
      const entry = await cached
      if (entry.status.engine === 'sqlglot' || now() - entry.at < SQLGLOT_PROBE_RETRY_MS) {
        return entry.status
      }
    }
    const probe = this.probe(python, env).then((status) => ({
      status,
      at: now()
    }))
    this.probes.set(python.path, probe)
    return (await probe).status
  }

  private async probe(
    python: { path: string; source: 'settings' | 'path' },
    env: NodeJS.ProcessEnv
  ): Promise<DbtLineageEngineStatus> {
    let result: ProcessResult
    try {
      result = await this.deps.run({
        program: python.path,
        args: ['-c', 'import sqlglot, sys; sys.stdout.write(sqlglot.__version__)'],
        env,
        timeoutMs: SQLGLOT_PROBE_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024
      })
    } catch (error) {
      return {
        engine: 'name-match',
        python: python.path,
        pythonSource: python.source,
        note: `Could not start ${python.path}: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    const version = result.stdout.trim()
    if (result.code === 0 && version) {
      return {
        engine: 'sqlglot',
        python: python.path,
        pythonSource: python.source,
        sqlglotVersion: version
      }
    }
    const tail = result.stderr.trim().split('\n').at(-1) ?? ''
    return {
      engine: 'name-match',
      python: python.path,
      pythonSource: python.source,
      note: tail.length > 0 ? tail : `python exited with code ${result.code ?? 'unknown'}`
    }
  }

  async analyse(
    python: string,
    env: NodeJS.ProcessEnv,
    dialect: string,
    nodes: SqlglotNodeInput[]
  ): Promise<SqlglotOutput> {
    if (nodes.length === 0) {
      return { ok: true, sqlglot: '', nodes: {} }
    }
    let result: ProcessResult
    try {
      result = await this.deps.run({
        program: python,
        args: ['-c', SQLGLOT_LINEAGE_SCRIPT],
        env,
        input: JSON.stringify({ dialect, nodes }),
        timeoutMs: SQLGLOT_RUN_TIMEOUT_MS,
        maxOutputBytes: 32 * 1024 * 1024
      })
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    if (result.timedOut) {
      return {
        ok: false,
        error: `sqlglot timed out after ${SQLGLOT_RUN_TIMEOUT_MS / 1000}s`
      }
    }
    const parsed = parseSidecarOutput(result.stdout)
    if (parsed) {
      return parsed
    }
    const tail = result.stderr.trim().split('\n').slice(-3).join('\n')
    return {
      ok: false,
      error: tail.length > 0 ? tail : `python exited with code ${result.code ?? 'unknown'}`
    }
  }
}

/** The last JSON object on stdout; a stray warning line before it is fine. */
export function parseSidecarOutput(stdout: string): SqlglotOutput | null {
  const lines = stdout.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) {
      continue
    }
    try {
      const raw = JSON.parse(line) as SqlglotOutput
      return typeof raw === 'object' && raw !== null && 'ok' in raw ? raw : null
    } catch {
      return null
    }
  }
  return null
}
