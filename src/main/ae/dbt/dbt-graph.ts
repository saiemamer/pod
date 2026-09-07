import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DBT_GRAPH_MAX_NODES_MAX,
  type DbtGraphColumn,
  type DbtGraphNode,
  type DbtGraphRequest,
  type DbtGraphResult
} from '../../../shared/ae/dbt-graph-types'
import {
  indexDbtGraph,
  inheritDbtColumns,
  selectDbtNeighbourhood,
  type DbtGraphIndex
} from '../../../shared/ae/dbt-lineage-graph'
import { parseDbtSelectList, stripDbtJinja } from '../../../shared/ae/dbt-select-list'
import { dbtCatalogPath } from './dbt-catalog-refresh'
import { loadDbtCatalog, type DbtCatalog } from './dbt-catalog'
import {
  DBT_LINEAGE_NODE_TYPES,
  dbtManifestPath,
  findDbtManifestNode,
  loadDbtManifest,
  type DbtManifest,
  type DbtManifestNode
} from './dbt-manifest'
import type { DbtProjectInfo } from './dbt-project-discovery'

/**
 * Pod: the lineage graph of one project. Nodes and edges come from the manifest,
 * columns from the catalog first, the manifest's column docs second, the model's own
 * select list third, and parents fourth. Rebuilt only when either artifact's mtime
 * moves; held in memory, one graph per project.
 */
export type DbtGraph = {
  projectDir: string
  manifestMtimeMs: number
  catalogMtimeMs: number
  manifestGeneratedAt?: string
  catalogExists: boolean
  index: DbtGraphIndex
  manifest: DbtManifest
}

export type DbtGraphSqlSource = { text: string; source: 'compiled' | 'source' }

/** The SQL to read for a node: the compiled file when dbt wrote one, else the model file. */
export function readDbtNodeSql(
  project: DbtProjectInfo,
  node: DbtManifestNode
): DbtGraphSqlSource | null {
  const compiled = join(
    project.projectDir,
    project.targetPath,
    'compiled',
    node.packageName,
    node.originalFilePath
  )
  const source = join(project.projectDir, node.originalFilePath)
  for (const [file, kind] of [
    [compiled, 'compiled'],
    [source, 'source']
  ] as const) {
    if (existsSync(file)) {
      try {
        return { text: readFileSync(file, 'utf8'), source: kind }
      } catch {
        // Why: a file that vanished between the check and the read means try the next.
      }
    }
  }
  return null
}

function columnsFor(
  node: DbtManifestNode,
  catalog: DbtCatalog | null,
  readSql: (node: DbtManifestNode) => DbtGraphSqlSource | null
): { columns: DbtGraphColumn[]; source: DbtGraphNode['columnSource'] } {
  const fromCatalog = catalog?.nodes.get(node.uniqueId)?.columns ?? []
  if (fromCatalog.length > 0) {
    const docs = new Map(node.columns.map((column) => [column.name.toLowerCase(), column]))
    return {
      source: 'catalog',
      columns: fromCatalog.map((column) => ({
        name: column.name,
        dataType: column.type,
        description: docs.get(column.name.toLowerCase())?.description ?? column.comment,
        source: 'catalog'
      }))
    }
  }
  if (node.columns.length > 0) {
    return {
      source: 'manifest',
      columns: node.columns.map((column) => ({
        ...column,
        source: 'manifest'
      }))
    }
  }
  if (node.resourceType === 'model' || node.resourceType === 'snapshot') {
    const sql = readSql(node)
    if (sql) {
      const text = sql.source === 'compiled' ? sql.text : stripDbtJinja(sql.text).sql
      const parsed = parseDbtSelectList(text)
      if (parsed.columns.length > 0) {
        return {
          source: 'parsed',
          columns: parsed.columns.map((name) => ({ name, source: 'parsed' }))
        }
      }
    }
  }
  return { source: 'none', columns: [] }
}

export function buildDbtGraphIndex(
  manifest: DbtManifest,
  catalog: DbtCatalog | null,
  readSql: (node: DbtManifestNode) => DbtGraphSqlSource | null
): DbtGraphIndex {
  const nodes: DbtGraphNode[] = []
  for (const node of manifest.nodes.values()) {
    if (!DBT_LINEAGE_NODE_TYPES.has(node.resourceType)) {
      continue
    }
    const { columns, source } = columnsFor(node, catalog, readSql)
    nodes.push({
      uniqueId: node.uniqueId,
      name: node.name,
      resourceType: node.resourceType,
      packageName: node.packageName,
      path: node.originalFilePath,
      materialized: node.materialized,
      database: node.database,
      schema: node.schema,
      alias: node.alias ?? node.identifier,
      description: node.description,
      columns,
      columnSource: source
    })
  }
  const edges = Object.entries(manifest.parentMap).flatMap(([child, parents]) =>
    parents.map((parent) => ({ source: parent, target: child }))
  )
  const index = indexDbtGraph(nodes, edges)
  inheritDbtColumns(index)
  return index
}

export class DbtGraphNotReadyError extends Error {
  constructor(file: string) {
    super(`No manifest at ${file}. Run \`orca dbt parse\` or open the Connection tab and parse.`)
    this.name = 'DbtGraphNotReadyError'
  }
}

export class DbtGraphService {
  private readonly graphs = new Map<string, DbtGraph>()

  constructor(
    readonly readSql: (
      project: DbtProjectInfo,
      node: DbtManifestNode
    ) => DbtGraphSqlSource | null = readDbtNodeSql
  ) {}

  /** The current graph for a project, rebuilt when manifest or catalog changed on disk. */
  load(project: DbtProjectInfo): DbtGraph {
    const manifestFile = dbtManifestPath(project)
    const manifest = loadDbtManifest(manifestFile)
    if (!manifest) {
      this.graphs.delete(project.projectDir)
      throw new DbtGraphNotReadyError(manifestFile)
    }
    const catalog = loadDbtCatalog(dbtCatalogPath(project))
    const cached = this.graphs.get(project.projectDir)
    if (
      cached &&
      cached.manifestMtimeMs === manifest.mtimeMs &&
      cached.catalogMtimeMs === (catalog?.mtimeMs ?? 0)
    ) {
      return cached
    }
    const graph: DbtGraph = {
      projectDir: project.projectDir,
      manifestMtimeMs: manifest.mtimeMs,
      catalogMtimeMs: catalog?.mtimeMs ?? 0,
      manifestGeneratedAt: manifest.generatedAt,
      catalogExists: catalog !== null,
      index: buildDbtGraphIndex(manifest, catalog, (node) => this.readSql(project, node)),
      manifest
    }
    this.graphs.set(project.projectDir, graph)
    return graph
  }

  forget(projectDir: string): void {
    this.graphs.delete(projectDir)
  }

  /** Finds the focus node by name, or by the file name of the path when no model is given. */
  focusNode(graph: DbtGraph, request: { model?: string; path: string }): DbtGraphNode {
    const name = request.model?.trim() || modelNameFromPath(request.path)
    const node = findDbtManifestNode(graph.manifest, name)
    const graphNode = node ? graph.index.nodes.get(node.uniqueId) : undefined
    if (!graphNode) {
      throw new Error(
        `No model named "${name}" in ${graph.manifest.file}. Run \`orca dbt parse\` if it is new.`
      )
    }
    return graphNode
  }

  neighbourhood(
    graph: DbtGraph,
    request: DbtGraphRequest,
    defaults: { depth: number; maxNodes: number }
  ): DbtGraphResult {
    const focus = this.focusNode(graph, request)
    const upstreamDepth = clamp(request.upstreamDepth ?? defaults.depth, 0, 20)
    const downstreamDepth = clamp(request.downstreamDepth ?? defaults.depth, 0, 20)
    const maxNodes = clamp(request.maxNodes ?? defaults.maxNodes, 2, DBT_GRAPH_MAX_NODES_MAX)
    const hood = selectDbtNeighbourhood(graph.index, focus.uniqueId, {
      upstreamDepth,
      downstreamDepth,
      maxNodes
    })
    return {
      projectDir: graph.projectDir,
      focus: focus.uniqueId,
      nodes: hood.nodeIds.map((id) => graph.index.nodes.get(id)).filter(isNode),
      edges: hood.edges,
      upstreamDepth,
      downstreamDepth,
      truncated: hood.truncated,
      moreUpstream: hood.moreUpstream,
      moreDownstream: hood.moreDownstream,
      totalNodes: graph.index.nodes.size,
      manifestGeneratedAt: graph.manifestGeneratedAt,
      catalogExists: graph.catalogExists
    }
  }
}

function isNode(node: DbtGraphNode | undefined): node is DbtGraphNode {
  return node !== undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** dbt names a model after its file, so `models/marts/orders.sql` is `orders`. */
export function modelNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).at(-1) ?? path
  return base.replace(/\.sql$/i, '')
}
