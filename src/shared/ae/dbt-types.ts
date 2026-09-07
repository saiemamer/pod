import type { AeDbtDistribution } from './dbt-settings-types'

/**
 * Pod: the dbt results that cross a process boundary (IPC to the renderer, RPC to the
 * CLI). Environment values never appear here; only file names and variable names do.
 */
export type DbtProjectSummary = {
  projectDir: string
  projectFile: string
  name: string
  profile?: string
  modelPaths: string[]
  macroPaths: string[]
  targetPath: string
}

export type DbtBinarySummary = {
  path: string
  source: 'settings' | 'path'
}

export type DbtManifestSummary = {
  file: string
  exists: boolean
  generatedAt?: string
  dbtVersion?: string
  nodeCount?: number
}

export type DbtContextSummary = {
  project: DbtProjectSummary
  repoRoot: string | null
  worktree: { id: string; repoId: string; path: string } | null
  domainId: string | null
  binary: DbtBinarySummary | null
  target?: string
  profiles: { dir?: string; source: string }
  /** Env files that were read, names only. */
  envFiles: string[]
  distribution: AeDbtDistribution
  showLimit: number
  manifest: DbtManifestSummary
}

export type DbtPathRequest = {
  /** A file or directory inside the project: the open file, or the caller's cwd. */
  path: string
  projectDir?: string
}

export type DbtShowRequest = DbtPathRequest & {
  model?: string
  sql?: string
  limit?: number
  target?: string
}

export type DbtCompileRequest = DbtPathRequest & {
  model?: string
  sql?: string
  target?: string
}

export type DbtParseRequest = DbtPathRequest & { target?: string }

export type DbtListModelsRequest = DbtPathRequest & {
  filter?: string
  refresh?: boolean
}

export type DbtModelRequest = DbtPathRequest & {
  model: string
  refresh?: boolean
}

export type DbtLineageRequest = DbtModelRequest & { depth?: number }

export type DbtShowResult = {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  limit: number
  command: string
  durationMs: number
  /** True when dbt's output hit the byte cap and rows may be missing. */
  truncated: boolean
  target?: string
}

export type DbtCompileResult = {
  sql: string
  model?: string
  /** Compiled file under target/, when dbt wrote one. */
  file?: string
  command: string
  durationMs: number
}

export type DbtParseResult = {
  command: string
  durationMs: number
  manifest: DbtManifestSummary
}

export type DbtModelSummary = {
  uniqueId: string
  name: string
  resourceType: string
  path: string
  materialized?: string
  database?: string
  schema?: string
  alias?: string
  tags: string[]
  description?: string
}

export type DbtLineageEntry = {
  uniqueId: string
  name: string
  resourceType: string
  depth: number
}

export type DbtColumnSummary = {
  name: string
  description?: string
  dataType?: string
}

export type DbtModelInfo = DbtModelSummary & {
  columns: DbtColumnSummary[]
  dependsOn: DbtLineageEntry[]
  referencedBy: DbtLineageEntry[]
}

export type DbtListModelsResult = {
  project: string
  count: number
  models: DbtModelSummary[]
}

export type DbtLineageResult = {
  model: DbtModelSummary
  depth: number
  upstream: DbtLineageEntry[]
  downstream: DbtLineageEntry[]
}

export const DBT_LINEAGE_DEPTH_MAX = 20
