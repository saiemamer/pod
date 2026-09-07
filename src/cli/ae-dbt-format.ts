import type {
  DbtCompileResult,
  DbtContextSummary,
  DbtLineageEntry,
  DbtLineageResult,
  DbtListModelsResult,
  DbtModelInfo,
  DbtParseResult,
  DbtShowResult
} from '../shared/ae/dbt-types'

/** Pod: human output for `orca dbt ...`; `--json` prints the raw result instead. */
export function formatDbtProject(result: DbtContextSummary): string {
  const { project, manifest } = result
  return [
    `${project.name} at ${project.projectDir}`,
    `profile: ${project.profile ?? 'none'}; target: ${result.target ?? 'profile default'}`,
    `profiles dir: ${result.profiles.dir ?? 'resolved by dbt'} (${result.profiles.source})`,
    `dbt: ${result.binary ? `${result.binary.path} (${result.binary.source})` : 'not found'}; distribution: ${result.distribution}`,
    `env files: ${result.envFiles.length > 0 ? result.envFiles.join(', ') : 'none'}`,
    `repo: ${result.repoRoot ?? 'none'}${result.worktree ? ` (worktree ${result.worktree.id})` : ''}; domain: ${result.domainId ?? 'none'}`,
    manifest.exists
      ? `manifest: ${manifest.nodeCount} nodes, dbt ${manifest.dbtVersion ?? '?'}, generated ${manifest.generatedAt ?? '?'}`
      : `manifest: none yet (run orca dbt parse)`
  ].join('\n')
}

export function formatDbtListModels(result: DbtListModelsResult): string {
  if (result.count === 0) {
    return `No models in ${result.project}.`
  }
  const lines = result.models.map(
    (model) => `${model.name}  ${model.materialized ?? '-'}  ${model.path}`
  )
  return [`${result.count} models in ${result.project}:`, ...lines].join('\n')
}

export function formatDbtModelInfo(result: DbtModelInfo): string {
  const lines = [
    `${result.name} (${result.uniqueId})`,
    `file: ${result.path}`,
    `materialized: ${result.materialized ?? '-'}; relation: ${[result.database, result.schema, result.alias ?? result.name].filter(Boolean).join('.')}`,
    `tags: ${result.tags.join(', ') || 'none'}`
  ]
  if (result.description) {
    lines.push(`description: ${result.description}`)
  }
  lines.push(`columns (${result.columns.length}):`)
  for (const column of result.columns) {
    lines.push(
      `  ${column.name}${column.dataType ? ` ${column.dataType}` : ''}${column.description ? `  ${column.description}` : ''}`
    )
  }
  lines.push(`depends on: ${names(result.dependsOn)}`)
  lines.push(`referenced by: ${names(result.referencedBy)}`)
  return lines.join('\n')
}

export function formatDbtLineage(result: DbtLineageResult): string {
  return [
    `${result.model.name} (depth ${result.depth})`,
    `upstream (${result.upstream.length}):`,
    ...result.upstream.map(lineageLine),
    `downstream (${result.downstream.length}):`,
    ...result.downstream.map(lineageLine)
  ].join('\n')
}

export function formatDbtShow(result: DbtShowResult): string {
  const header = `${result.rowCount} rows (limit ${result.limit}${result.target ? `, target ${result.target}` : ''}, ${Math.round(result.durationMs / 1000)}s)`
  if (result.columns.length === 0) {
    return header
  }
  const cells = result.rows.map((row) => row.map(cellText))
  const widths = result.columns.map((column, index) =>
    Math.min(40, Math.max(column.length, ...cells.map((row) => row[index]?.length ?? 0)))
  )
  const line = (values: string[]): string =>
    values.map((value, index) => value.padEnd(widths[index]).slice(0, widths[index])).join('  ')
  const lines = [header, line(result.columns), line(widths.map((width) => '-'.repeat(width)))]
  for (const row of cells) {
    lines.push(line(row))
  }
  if (result.truncated) {
    lines.push('(output was cut at the byte cap; lower the limit or select fewer columns)')
  }
  return lines.join('\n')
}

export function formatDbtCompile(result: DbtCompileResult): string {
  return result.sql
}

export function formatDbtParse(result: DbtParseResult): string {
  const { manifest } = result
  return `parsed ${manifest.nodeCount ?? 0} nodes in ${Math.round(result.durationMs / 1000)}s (dbt ${manifest.dbtVersion ?? '?'}) -> ${manifest.file}`
}

function names(entries: DbtLineageEntry[]): string {
  return entries.map((entry) => entry.name).join(', ') || 'none'
}

function lineageLine(entry: DbtLineageEntry): string {
  return `  ${'  '.repeat(entry.depth - 1)}${entry.name} (${entry.resourceType})`
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value).replace(/\s+/g, ' ')
}
