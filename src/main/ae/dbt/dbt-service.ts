import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AE_DBT_SHOW_LIMIT_MAX } from '../../../shared/ae/dbt-settings-types'
import {
  DBT_LINEAGE_DEPTH_MAX,
  type DbtCompileRequest,
  type DbtCompileResult,
  type DbtContextSummary,
  type DbtLineageRequest,
  type DbtLineageResult,
  type DbtListModelsRequest,
  type DbtListModelsResult,
  type DbtModelInfo,
  type DbtModelRequest,
  type DbtModelSummary,
  type DbtParseRequest,
  type DbtParseResult,
  type DbtPathRequest,
  type DbtShowRequest,
  type DbtShowResult
} from '../../../shared/ae/dbt-types'
import {
  resolveDbtContext,
  summarizeDbtContext,
  summarizeDbtManifest,
  type DbtContext,
  type DbtContextDeps
} from './dbt-context'
import {
  dbtManifestPath,
  findDbtManifestNode,
  listDbtManifestModels,
  loadDbtManifest,
  walkDbtLineage,
  type DbtManifest,
  type DbtManifestNode
} from './dbt-manifest'
import { describeDbtFailure, runDbt, type DbtRunDeps, type DbtRunResult } from './dbt-runner'
import {
  collectDbtJsonLogErrors,
  parseDbtCompiledFromJsonLogs,
  parseDbtCompiledFromTextLogs,
  parseDbtShowOutput
} from './dbt-show-output'

/**
 * Pod: the dbt operations behind the editor (Cmd+Enter, Compiled tab), the IPC layer
 * and `orca dbt ...`. One instance per app; runs are serialised per project because
 * dbt Core writes target/ and partial_parse.msgpack while it works.
 */
export class DbtRunError extends Error {
  constructor(
    message: string,
    readonly result?: DbtRunResult
  ) {
    super(message)
    this.name = 'DbtRunError'
  }
}

export class AeDbtService {
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly deps: DbtContextDeps,
    private readonly runDeps?: DbtRunDeps
  ) {}

  resolve(request: DbtPathRequest & { target?: string }): Promise<DbtContext> {
    return resolveDbtContext(this.deps, request)
  }

  async project(request: DbtPathRequest): Promise<DbtContextSummary> {
    return summarizeDbtContext(await this.resolve(request))
  }

  async parse(request: DbtParseRequest): Promise<DbtParseResult> {
    const context = await this.resolve(request)
    const result = await this.run(context, ['parse'])
    const manifest = this.manifestSummary(context)
    if (!manifest.exists) {
      throw new DbtRunError(`dbt parse finished but ${manifest.file} was not written`, result)
    }
    return { command: result.command, durationMs: result.durationMs, manifest }
  }

  async listModels(request: DbtListModelsRequest): Promise<DbtListModelsResult> {
    const context = await this.resolve(request)
    const manifest = await this.ensureManifest(context, request.refresh === true)
    const models = listDbtManifestModels(manifest, request.filter).map(toSummary)
    return { project: context.project.name, count: models.length, models }
  }

  async modelInfo(request: DbtModelRequest): Promise<DbtModelInfo> {
    const context = await this.resolve(request)
    const manifest = await this.ensureManifest(context, request.refresh === true)
    const node = requireNode(manifest, request.model)
    return {
      ...toSummary(node),
      columns: node.columns,
      dependsOn: walkDbtLineage(manifest, node.uniqueId, 'upstream', 1),
      referencedBy: walkDbtLineage(manifest, node.uniqueId, 'downstream', 1)
    }
  }

  async lineage(request: DbtLineageRequest): Promise<DbtLineageResult> {
    const context = await this.resolve(request)
    const manifest = await this.ensureManifest(context, request.refresh === true)
    const node = requireNode(manifest, request.model)
    const depth = Math.min(
      DBT_LINEAGE_DEPTH_MAX,
      Math.max(1, request.depth ?? context.settings.lineageDepth)
    )
    return {
      model: toSummary(node),
      depth,
      upstream: walkDbtLineage(manifest, node.uniqueId, 'upstream', depth),
      downstream: walkDbtLineage(manifest, node.uniqueId, 'downstream', depth)
    }
  }

  /** Runs a warehouse query. The limit is capped so a stray Cmd+Enter cannot pull a table. */
  async show(request: DbtShowRequest): Promise<DbtShowResult> {
    const context = await this.resolve(request)
    const selector = selectorArgs(request)
    const limit = Math.min(
      AE_DBT_SHOW_LIMIT_MAX,
      Math.max(1, Math.trunc(request.limit ?? context.settings.showLimit))
    )
    const result = await this.run(context, [
      'show',
      ...selector,
      '--limit',
      String(limit),
      '--output',
      'json'
    ])
    const table = parseDbtShowOutput(result.stdout)
    if (!table) {
      throw new DbtRunError(`dbt show printed no JSON rows:\n${describeDbtFailure(result)}`, result)
    }
    return {
      columns: table.columns,
      rows: table.rows,
      rowCount: table.rowCount,
      limit,
      command: result.command,
      durationMs: result.durationMs,
      truncated: result.truncated,
      ...(context.target ? { target: context.target } : {})
    }
  }

  async compile(request: DbtCompileRequest): Promise<DbtCompileResult> {
    const context = await this.resolve(request)
    const selector = selectorArgs(request)
    // Why not quiet: the compiled SQL arrives as an INFO event, which --quiet would drop.
    const result = await this.run(context, ['compile', ...selector], {
      quiet: false,
      logFormat: 'json'
    })
    let sql =
      parseDbtCompiledFromJsonLogs(result.stdout) ?? parseDbtCompiledFromTextLogs(result.stdout)
    let file: string | undefined
    if (request.model) {
      const manifest = loadDbtManifest(dbtManifestPath(context.project))
      const node = manifest ? findDbtManifestNode(manifest, request.model) : null
      if (node) {
        file = join(
          context.project.projectDir,
          context.project.targetPath,
          'compiled',
          node.packageName,
          node.originalFilePath
        )
        sql ??= readCompiledFile(file)
      }
    }
    if (sql === null || sql === undefined) {
      throw new DbtRunError(`dbt compile returned no SQL:\n${describeDbtFailure(result)}`, result)
    }
    return {
      sql,
      ...(request.model ? { model: request.model } : {}),
      ...(file ? { file } : {}),
      command: result.command,
      durationMs: result.durationMs
    }
  }

  /** What the manifest on disk says right now, for callers that already hold a context. */
  manifestSummary(context: DbtContext): DbtParseResult['manifest'] {
    return summarizeDbtManifest(context.project)
  }

  private async ensureManifest(context: DbtContext, refresh: boolean): Promise<DbtManifest> {
    const file = dbtManifestPath(context.project)
    const existing = refresh ? null : loadDbtManifest(file)
    if (existing) {
      return existing
    }
    const result = await this.run(context, ['parse'])
    const manifest = loadDbtManifest(file)
    if (!manifest) {
      throw new DbtRunError(`dbt parse finished but ${file} was not written`, result)
    }
    return manifest
  }

  /** Runs one dbt command in the project's queue; throws DbtRunError with dbt's own words. */
  run(
    context: DbtContext,
    args: string[],
    options: { quiet?: boolean; logFormat?: 'text' | 'json' } = {}
  ): Promise<DbtRunResult> {
    if (!context.binary) {
      throw new DbtRunError(
        'dbt was not found on PATH. Install dbt, or set its path in Settings > Analytics Tools.'
      )
    }
    const binary = context.binary.path
    const previous = this.queues.get(context.project.projectDir) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await runDbt(
          {
            binary,
            projectDir: context.project.projectDir,
            args,
            target: context.target,
            profilesDir: context.profiles.dir,
            env: context.env,
            ...options
          },
          this.runDeps
        )
        if (!result.ok) {
          const errors = options.logFormat === 'json' ? collectDbtJsonLogErrors(result.stdout) : []
          throw new DbtRunError(
            errors.length > 0 ? errors.join('\n') : describeDbtFailure(result),
            result
          )
        }
        return result
      })
    this.queues.set(context.project.projectDir, next)
    return next
  }
}

function selectorArgs(request: { model?: string; sql?: string }): string[] {
  const model = request.model?.trim()
  const sql = request.sql?.trim()
  if (model) {
    return ['--select', model]
  }
  if (sql) {
    return ['--inline', sql]
  }
  throw new DbtRunError('Pass a model name or inline SQL.')
}

function requireNode(manifest: DbtManifest, name: string): DbtManifestNode {
  const node = findDbtManifestNode(manifest, name)
  if (!node) {
    throw new DbtRunError(
      `No node named "${name}" in ${manifest.file}. Run \`orca dbt parse\` if the model is new.`
    )
  }
  return node
}

function toSummary(node: DbtManifestNode): DbtModelSummary {
  return {
    uniqueId: node.uniqueId,
    name: node.name,
    resourceType: node.resourceType,
    path: node.originalFilePath,
    materialized: node.materialized,
    database: node.database,
    schema: node.schema,
    alias: node.alias,
    tags: node.tags,
    description: node.description
  }
}

function readCompiledFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

let installed: AeDbtService | null = null

export function installAeDbtService(deps: DbtContextDeps, runDeps?: DbtRunDeps): AeDbtService {
  installed = new AeDbtService(deps, runDeps)
  return installed
}

export function getAeDbtService(): AeDbtService {
  if (!installed) {
    throw new Error('dbt service not installed')
  }
  return installed
}

export function getAeDbtServiceIfInstalled(): AeDbtService | null {
  return installed
}
