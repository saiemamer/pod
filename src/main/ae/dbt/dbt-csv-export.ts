import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DbtExportCsvResult } from '../../../shared/ae/dbt-types'
import type { DbtProjectInfo } from './dbt-project-discovery'

/**
 * Pod: writes the rows shown in the dock to target/<label>_results.csv, next to the
 * other dbt artifacts, so the file is inside the project and already git-ignored.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Why RFC 4180: quote when the text holds a delimiter, a quote or a line break.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(columns.map((_, index) => csvCell(row[index])).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

/** A file name from a model name or a query's first line. */
export function csvFileName(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${slug || 'query'}_results.csv`
}

export function writeDbtResultsCsv(
  project: DbtProjectInfo,
  label: string,
  columns: string[],
  rows: unknown[][]
): DbtExportCsvResult {
  const dir = join(project.projectDir, project.targetPath)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, csvFileName(label))
  writeFileSync(file, toCsv(columns, rows), 'utf8')
  return { file, rowCount: rows.length }
}
