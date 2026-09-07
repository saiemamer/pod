import type {
  DbtCatalogTree,
  DbtColumnLineageRequest,
  DbtColumnLineageResult,
  DbtGraphRequest,
  DbtGraphResult,
  DbtLineageEngineStatus
} from '../../../shared/ae/dbt-graph-types'
import type { DbtLineageResult, DbtPathRequest } from '../../../shared/ae/dbt-types'
import { dbtManifestPath, loadDbtManifest, walkDbtLineage } from './dbt-manifest'
import { buildDbtCatalogTree, loadDbtCatalog } from './dbt-catalog'
import { dbtCatalogPath } from './dbt-catalog-refresh'
import { DbtColumnLineageService } from './dbt-column-lineage'
import { DbtGraphService } from './dbt-graph'
import type { DbtContext } from './dbt-context'
import type { AeDbtService } from './dbt-service'
import { DbtSqlglotSidecar, sqlglotDialectFor } from './dbt-sqlglot-sidecar'

/**
 * Pod: the Phase 3 operations behind the Lineage tab, the Database explorer and
 * `orca dbt lineage | column-lineage`. Each resolves the dbt context from a path like
 * every other dbt call, then reads artifacts; only `refresh` runs dbt.
 */
export type DbtLineageServices = {
  graph: DbtGraphService
  columns: DbtColumnLineageService
  sidecar: DbtSqlglotSidecar
}

export function createDbtLineageServices(): DbtLineageServices {
  const graph = new DbtGraphService()
  const sidecar = new DbtSqlglotSidecar()
  return {
    graph,
    sidecar,
    // Why the graph's reader: the same file feeds both the column list and the engine.
    columns: new DbtColumnLineageService(sidecar, graph.readSql)
  }
}

let installed: DbtLineageServices | null = null

export function installDbtLineageServices(): DbtLineageServices {
  installed = createDbtLineageServices()
  return installed
}

export function getDbtLineageServices(): DbtLineageServices {
  if (!installed) {
    throw new Error('dbt lineage services not installed')
  }
  return installed
}

async function contextFor(
  service: AeDbtService,
  request: DbtPathRequest & { refresh?: boolean }
): Promise<DbtContext> {
  const context = await service.resolve(request)
  if (request.refresh) {
    await service.run(context, ['parse'])
  }
  return context
}

export async function dbtGraphRequest(
  service: AeDbtService,
  services: DbtLineageServices,
  request: DbtGraphRequest
): Promise<DbtGraphResult> {
  const context = await contextFor(service, request)
  const graph = services.graph.load(context.project)
  return services.graph.neighbourhood(graph, request, {
    depth: context.settings.lineageDepth,
    maxNodes: context.settings.lineageMaxNodes
  })
}

export async function dbtColumnLineageRequest(
  service: AeDbtService,
  services: DbtLineageServices,
  request: DbtColumnLineageRequest
): Promise<DbtColumnLineageResult> {
  const context = await contextFor(service, request)
  const graph = services.graph.load(context.project)
  const focus = services.graph.focusNode(graph, request)
  return services.columns.lineage(
    graph,
    context.project,
    focus,
    {
      python: context.toolOverrides.python,
      env: context.env,
      dialect: sqlglotDialectFor(context.settings.coreAdapter)
    },
    request,
    {
      depth: context.settings.lineageDepth,
      maxNodes: context.settings.lineageMaxNodes
    }
  )
}

/** `orca dbt lineage`: the manifest walk, plus each node's columns from the graph. */
export async function dbtLineageWithColumns(
  service: AeDbtService,
  services: DbtLineageServices,
  request: DbtGraphRequest & { model: string }
): Promise<DbtLineageResult & { columns: Record<string, string[]> }> {
  const context = await contextFor(service, request)
  const graph = services.graph.load(context.project)
  const focus = services.graph.focusNode(graph, request)
  const depth = Math.min(20, Math.max(1, request.upstreamDepth ?? context.settings.lineageDepth))
  const upstream = walkDbtLineage(graph.manifest, focus.uniqueId, 'upstream', depth)
  const downstream = walkDbtLineage(graph.manifest, focus.uniqueId, 'downstream', depth)
  const columns: Record<string, string[]> = {}
  const ids = [focus.uniqueId, ...upstream, ...downstream].map((e) =>
    typeof e === 'string' ? e : e.uniqueId
  )
  for (const id of ids) {
    columns[id] = (graph.index.nodes.get(id)?.columns ?? []).map((column) => column.name)
  }
  const manifestNode = graph.manifest.nodes.get(focus.uniqueId)
  return {
    model: {
      uniqueId: focus.uniqueId,
      name: focus.name,
      resourceType: focus.resourceType,
      path: focus.path,
      materialized: focus.materialized,
      database: focus.database,
      schema: focus.schema,
      alias: focus.alias,
      tags: manifestNode?.tags ?? [],
      description: focus.description
    },
    depth,
    upstream,
    downstream,
    columns
  }
}

export async function dbtCatalogTreeRequest(
  service: AeDbtService,
  request: DbtPathRequest
): Promise<DbtCatalogTree> {
  const context = await service.resolve(request)
  const file = dbtCatalogPath(context.project)
  return buildDbtCatalogTree(
    context.project.projectDir,
    file,
    loadDbtCatalog(file),
    loadDbtManifest(dbtManifestPath(context.project))
  )
}

export async function dbtLineageEngineRequest(
  service: AeDbtService,
  services: DbtLineageServices,
  request: DbtPathRequest
): Promise<DbtLineageEngineStatus> {
  const context = await service.resolve(request)
  return services.sidecar.status(context.toolOverrides.python, context.env)
}
