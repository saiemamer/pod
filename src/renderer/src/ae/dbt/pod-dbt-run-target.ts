/**
 * Pod: what Cmd+Enter sends to dbt. A non-empty selection runs as inline SQL (Jinja
 * included, so `ref()` works); otherwise the whole model runs by name, which is the file
 * name without its extension, as dbt names models.
 */
export type PodDbtRunTarget = { sql: string } | { model: string }

export function dbtModelNameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).at(-1) ?? filePath
  return base.replace(/\.sql$/i, '')
}

export function podDbtRunTarget(filePath: string, selection: string | null): PodDbtRunTarget {
  const sql = selection?.trim() ?? ''
  return sql.length > 0 ? { sql } : { model: dbtModelNameFromPath(filePath) }
}

/** Short label for the dock header: the model name, or the first line of the selection. */
export function podDbtRunLabel(target: PodDbtRunTarget): string {
  if ('model' in target) {
    return target.model
  }
  const firstLine = target.sql.split('\n')[0].trim()
  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}…` : firstLine
}

/** Strips Electron's IPC wrapper so the dock shows dbt's own sentence. */
export function podDbtErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').trim()
}
