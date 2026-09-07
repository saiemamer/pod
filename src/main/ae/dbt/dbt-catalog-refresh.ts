import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DbtCatalogSummary } from '../../../shared/ae/dbt-types'
import type { AeDbtDistribution } from '../../../shared/ae/dbt-settings-types'
import type { DbtProjectInfo } from './dbt-project-discovery'

/**
 * Pod: target/catalog.json holds the warehouse's view of every relation (columns and
 * types), which the explorer and column lineage read. `dbt docs generate` writes it;
 * on BigQuery that queries INFORMATION_SCHEMA for each dataset, so Pod runs it once per
 * project per session and only when parseOnLoad is on.
 */
export const DBT_CATALOG_FILE = 'catalog.json'

export function dbtCatalogPath(project: DbtProjectInfo): string {
  return join(project.projectDir, project.targetPath, DBT_CATALOG_FILE)
}

/** The commands, in order, that bring manifest and catalog up to date. */
export function dbtCatalogCommands(distribution: AeDbtDistribution): string[][] {
  // Why: Fusion's compile writes both artifacts; Core needs a parse for the manifest
  // and docs generate for the catalog.
  return distribution === 'fusion'
    ? [['compile', '--write-catalog']]
    : [['parse'], ['docs', 'generate']]
}

type CatalogSummaryCacheEntry = { mtimeMs: number; summary: DbtCatalogSummary }
const cache = new Map<string, CatalogSummaryCacheEntry>()

/** Reads only the metadata block and counts nodes; the columns stay on disk. */
export function summarizeDbtCatalog(project: DbtProjectInfo): DbtCatalogSummary {
  const file = dbtCatalogPath(project)
  let mtimeMs: number
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    cache.delete(file)
    return { file, exists: false }
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.summary
  }
  const summary = parseDbtCatalogSummary(file, readFileSync(file, 'utf8'))
  cache.set(file, { mtimeMs, summary })
  return summary
}

export function parseDbtCatalogSummary(file: string, text: string): DbtCatalogSummary {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { file, exists: true }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { file, exists: true }
  }
  const record = raw as Record<string, unknown>
  const metadata =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {}
  const count = (bucket: unknown): number =>
    typeof bucket === 'object' && bucket !== null ? Object.keys(bucket).length : 0
  const summary: DbtCatalogSummary = {
    file,
    exists: true,
    nodeCount: count(record.nodes) + count(record.sources)
  }
  if (typeof metadata.generated_at === 'string') {
    summary.generatedAt = metadata.generated_at
  }
  return summary
}

/** Which projects were refreshed this session, so an editor tab costs one run, not one per open. */
export class DbtCatalogSessionLedger {
  private readonly done = new Set<string>()
  private readonly running = new Map<string, Promise<unknown>>()

  has(projectDir: string): boolean {
    return this.done.has(projectDir)
  }

  inFlight(projectDir: string): Promise<unknown> | undefined {
    return this.running.get(projectDir)
  }

  track<T>(projectDir: string, work: Promise<T>): Promise<T> {
    this.running.set(projectDir, work)
    return work
      .then((value) => {
        this.done.add(projectDir)
        return value
      })
      .finally(() => {
        if (this.running.get(projectDir) === work) {
          this.running.delete(projectDir)
        }
      })
  }

  forget(projectDir: string): void {
    this.done.delete(projectDir)
  }
}
