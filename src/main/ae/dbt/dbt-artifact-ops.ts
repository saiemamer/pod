import type {
  DbtCatalogRequest,
  DbtCatalogResult,
  DbtExportCsvRequest,
  DbtExportCsvResult,
  DbtResolveRefRequest,
  DbtResolveRefResult
} from '../../../shared/ae/dbt-types'
import {
  dbtCatalogCommands,
  DbtCatalogSessionLedger,
  summarizeDbtCatalog
} from './dbt-catalog-refresh'
import { writeDbtResultsCsv } from './dbt-csv-export'
import { dbtManifestPath, findDbtManifestNode, loadDbtManifest } from './dbt-manifest'
import { resolveDbtRef } from './dbt-ref-resolve'
import type { AeDbtService } from './dbt-service'
import { join } from 'node:path'

/**
 * Pod: the artifact operations behind the editor that are not a single dbt command:
 * the once-per-session catalog refresh, ref() resolution and the CSV export. Kept out
 * of dbt-service.ts so that file stays under the line cap.
 */
export const catalogLedger = new DbtCatalogSessionLedger()

export async function ensureDbtCatalog(
  service: AeDbtService,
  request: DbtCatalogRequest,
  ledger: DbtCatalogSessionLedger = catalogLedger
): Promise<DbtCatalogResult> {
  const context = await service.resolve(request)
  const projectDir = context.project.projectDir
  const summarize = (
    commands: string[],
    durationMs: number,
    outcome: DbtCatalogResult['outcome']
  ) => ({
    outcome,
    commands,
    durationMs,
    manifest: service.manifestSummary(context),
    catalog: summarizeDbtCatalog(context.project)
  })
  // Why check the file: a target/ wiped after this session's refresh must be rebuilt.
  const done = ledger.has(projectDir) && service.manifestSummary(context).exists
  if (!request.force && (!context.settings.parseOnLoad || done)) {
    return summarize([], 0, 'skipped')
  }
  const inFlight = ledger.inFlight(projectDir)
  if (inFlight && !request.force) {
    return summarize([], 0, 'running')
  }
  const started = Date.now()
  const commands: string[] = []
  const work = (async () => {
    for (const args of dbtCatalogCommands(context.settings.distribution)) {
      const result = await service.run(context, args)
      commands.push(result.command)
    }
  })()
  await ledger.track(projectDir, work)
  return summarize(commands, Date.now() - started, 'refreshed')
}

export async function resolveDbtRefRequest(
  service: AeDbtService,
  request: DbtResolveRefRequest
): Promise<DbtResolveRefResult> {
  const context = await service.resolve(request)
  const manifest = loadDbtManifest(dbtManifestPath(context.project))
  const node = manifest ? findDbtManifestNode(manifest, request.name) : null
  const preferred =
    node && (!request.packageName || node.packageName === request.packageName)
      ? join(context.project.projectDir, node.originalFilePath)
      : null
  return resolveDbtRef(context.project, request.name, preferred)
}

export async function exportDbtCsv(
  service: AeDbtService,
  request: DbtExportCsvRequest
): Promise<DbtExportCsvResult> {
  const context = await service.resolve(request)
  return writeDbtResultsCsv(context.project, request.label, request.columns, request.rows)
}
