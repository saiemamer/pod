import type {
  DbtCatalogRequest,
  DbtCatalogResult,
  DbtCatalogRun,
  DbtCatalogRunRequest,
  DbtExportCsvRequest,
  DbtExportCsvResult,
  DbtResolveRefRequest,
  DbtResolveRefResult
} from '../../../shared/ae/dbt-types'
import {
  describeDbtCatalogFailure,
  readDbtCatalogSkips,
  stripPythonWarnings
} from './dbt-catalog-output'
import {
  dbtCatalogCommands,
  dbtCatalogPath,
  DbtCatalogSessionLedger,
  summarizeDbtCatalog
} from './dbt-catalog-refresh'
import type { DbtContext } from './dbt-context'
import { writeDbtResultsCsv } from './dbt-csv-export'
import { dbtManifestPath, findDbtManifestNode, loadDbtManifest } from './dbt-manifest'
import { resolveDbtRef } from './dbt-ref-resolve'
import { DbtRunError, type AeDbtService } from './dbt-service'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pod: the artifact operations behind the editor that are not a single dbt command:
 * the once-per-session catalog refresh and its last outcome, ref() resolution and the CSV export. Kept out
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
  const summarize = (outcome: DbtCatalogResult['outcome'], run?: DbtCatalogRun) => ({
    outcome,
    commands: outcome === 'refreshed' || outcome === 'failed' ? (run?.commands ?? []) : [],
    durationMs: outcome === 'refreshed' || outcome === 'failed' ? (run?.durationMs ?? 0) : 0,
    manifest: service.manifestSummary(context),
    catalog: summarizeDbtCatalog(context.project),
    ...(run ? { run } : {})
  })
  // Why check the file: a target/ wiped after this session's refresh must be rebuilt.
  const done = ledger.has(projectDir) && service.manifestSummary(context).exists
  if (!request.force && (!context.settings.parseOnLoad || done)) {
    return summarize('skipped', ledger.last(projectDir))
  }
  const inFlight = ledger.inFlight(projectDir)
  if (inFlight && !request.force) {
    return summarize('running', ledger.last(projectDir))
  }
  // Why a failed run still counts as done: the automatic run must not go back to the
  // warehouse on every file open; the Database tab shows the error and offers a retry.
  const run = await ledger.track(
    projectDir,
    runDbtCatalog(service, context, (next) => ledger.record(projectDir, next))
  )
  return summarize(run.status === 'failed' ? 'failed' : 'refreshed', run)
}

/** The last catalog run this session; with `wait`, after the one in flight ends. */
export async function dbtCatalogRunRequest(
  service: AeDbtService,
  request: DbtCatalogRunRequest,
  ledger: DbtCatalogSessionLedger = catalogLedger
): Promise<DbtCatalogRun | null> {
  const context = await service.resolve(request)
  const projectDir = context.project.projectDir
  const inFlight = ledger.inFlight(projectDir)
  if (request.wait && inFlight) {
    await inFlight.catch(() => undefined)
  }
  return ledger.last(projectDir) ?? null
}

async function runDbtCatalog(
  service: AeDbtService,
  context: DbtContext,
  record: (run: DbtCatalogRun) => void
): Promise<DbtCatalogRun> {
  const startedAt = Date.now()
  const commands: string[] = []
  record({ status: 'running', startedAt, commands: [] })
  const catalogFile = dbtCatalogPath(context.project)
  const before = mtimeOf(catalogFile)
  const finish = (fields: Omit<DbtCatalogRun, 'startedAt' | 'commands'>): DbtCatalogRun => {
    const run = { ...fields, startedAt, commands, durationMs: Date.now() - startedAt }
    record(run)
    return run
  }
  const steps = dbtCatalogCommands(context.settings.distribution)
  let exitedWithErrors: string | null = null
  for (const [index, args] of steps.entries()) {
    const step = `dbt ${args.filter((arg) => !arg.startsWith('--')).join(' ')}`
    try {
      commands.push((await service.run(context, args)).command)
    } catch (error) {
      const result = error instanceof DbtRunError ? error.result : undefined
      if (result) {
        commands.push(result.command)
      }
      const message = error instanceof Error ? error.message : String(error)
      // Why: dbt exits non-zero when some datasets refuse access, after writing the
      // catalog; that catalog is a result, not a failure.
      const last = index === steps.length - 1
      if (!last || !writtenSince(catalogFile, before)) {
        return finish({
          status: 'failed',
          failure: describeDbtCatalogFailure(result, message, step)
        })
      }
      exitedWithErrors = stripPythonWarnings(`${result?.stdout ?? ''}\n${result?.stderr ?? ''}`)
    }
  }
  if (!writtenSince(catalogFile, before)) {
    const message = `The run finished but ${catalogFile} was not written.`
    return finish({
      status: 'failed',
      failure: { title: 'No catalog was written', hint: message, details: message }
    })
  }
  const skipped = readDbtCatalogSkips(readFileSync(catalogFile, 'utf8')) ?? []
  if (skipped.length === 0 && exitedWithErrors !== null) {
    const line = /dbt encountered \d+ failures? while writing the catalog/.exec(exitedWithErrors)
    skipped.push({ message: line?.[0] ?? 'dbt reported errors while writing the catalog' })
  }
  return finish(skipped.length > 0 ? { status: 'partial', skipped } : { status: 'ok' })
}

function mtimeOf(file: string): number | null {
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

function writtenSince(file: string, before: number | null): boolean {
  const now = mtimeOf(file)
  return now !== null && now !== before
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
