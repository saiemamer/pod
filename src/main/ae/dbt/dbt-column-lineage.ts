import { createHash } from 'node:crypto'
import {
  DBT_COLUMN_LINEAGE_MAX_PASSES,
  DBT_GRAPH_MAX_NODES_MAX,
  type DbtColumnLineageEdge,
  type DbtColumnLineageRequest,
  type DbtColumnLineageResult,
  type DbtGraphNode,
  type DbtLineageEngineStatus
} from '../../../shared/ae/dbt-graph-types'
import {
  indexDbtColumnEdges,
  propagateDbtColumnLineage,
  selectDbtNeighbourhood
} from '../../../shared/ae/dbt-lineage-graph'
import { dbtRelationIdentifier, stripDbtJinja } from '../../../shared/ae/dbt-select-list'
import type { DbtGraph, DbtGraphSqlSource } from './dbt-graph'
import type { DbtManifestNode } from './dbt-manifest'
import type { DbtProjectInfo } from './dbt-project-discovery'
import type { DbtSqlglotSidecar, SqlglotNodeInput, SqlglotNodeOutput } from './dbt-sqlglot-sidecar'

/**
 * Pod: which upstream columns feed a column, and which downstream columns it feeds.
 * Every model in the neighbourhood is analysed once by sqlglot (compiled SQL when dbt
 * wrote it, else the model with its Jinja stripped); a model the engine cannot read
 * gets name matching against its parents, and the answer says which ones those were.
 */
export type DbtColumnLineageEngineContext = {
  python?: string
  env: NodeJS.ProcessEnv
  dialect: string
}

export type DbtColumnLineageDefaults = { depth: number; maxNodes: number }

type NodeAnalysis = {
  edges: DbtColumnLineageEdge[]
  engine: 'sqlglot' | 'name-match'
  sqlSource?: 'compiled' | 'source'
}

/** Relation name without quoting, so `` `proj`.`dbt`.`orders` `` matches proj.dbt.orders. */
export function bareRelationName(node: DbtManifestNode): string | null {
  if (node.relationName) {
    return node.relationName.replace(/[`"[\]]/g, '')
  }
  const table = node.alias ?? node.identifier ?? node.name
  return [node.database, node.schema, table].filter(Boolean).join('.') || null
}

/** Maps relation names in the SQL to parent ids, and lists their columns for sqlglot. */
export function buildSidecarInput(
  graph: DbtGraph,
  node: DbtGraphNode,
  sql: DbtGraphSqlSource
): { input: SqlglotNodeInput; relations: Map<string, string> } {
  const parents = graph.index.parents.get(node.uniqueId) ?? []
  const relations = new Map<string, string>()
  const schema: Record<string, string[]> = {}
  const add = (identifier: string, parentId: string): void => {
    relations.set(identifier.toLowerCase(), parentId)
    schema[identifier] = (graph.index.nodes.get(parentId)?.columns ?? []).map((c) => c.name)
  }
  let text = sql.text
  if (sql.source === 'compiled') {
    for (const parentId of parents) {
      const manifestNode = graph.manifest.nodes.get(parentId)
      const relation = manifestNode ? bareRelationName(manifestNode) : null
      if (relation) {
        add(relation, parentId)
      }
    }
  } else {
    const stripped = stripDbtJinja(sql.text)
    text = stripped.sql
    for (const ref of stripped.refs) {
      const identifier = dbtRelationIdentifier(ref)
      const parentId = parents.find((id) => {
        const parent = graph.index.nodes.get(id)
        if (!parent) {
          return false
        }
        if (ref.kind === 'ref') {
          return (
            parent.name === ref.name && (!ref.packageName || parent.packageName === ref.packageName)
          )
        }
        return (
          parent.resourceType === 'source' &&
          parent.uniqueId.endsWith(`.${ref.sourceName}.${ref.tableName}`)
        )
      })
      if (parentId) {
        add(identifier, parentId)
      }
    }
  }
  return { input: { id: node.uniqueId, sql: text, schema }, relations }
}

function nameMatchEdges(graph: DbtGraph, node: DbtGraphNode): DbtColumnLineageEdge[] {
  const edges: DbtColumnLineageEdge[] = []
  for (const parentId of graph.index.parents.get(node.uniqueId) ?? []) {
    const parent = graph.index.nodes.get(parentId)
    if (!parent) {
      continue
    }
    const parentColumns = new Map(parent.columns.map((c) => [c.name.toLowerCase(), c.name]))
    for (const column of node.columns) {
      const match = parentColumns.get(column.name.toLowerCase())
      if (match) {
        edges.push({
          from: { uniqueId: parentId, column: match },
          to: { uniqueId: node.uniqueId, column: column.name },
          engine: 'name-match'
        })
      }
    }
  }
  return edges
}

function sidecarEdges(
  node: DbtGraphNode,
  output: SqlglotNodeOutput,
  relations: Map<string, string>,
  sqlSource: 'compiled' | 'source'
): DbtColumnLineageEdge[] | null {
  if (!output.ok) {
    return null
  }
  const edges: DbtColumnLineageEdge[] = []
  for (const [column, refs] of Object.entries(output.columns)) {
    for (const ref of refs) {
      const parentId = relations.get(ref.relation.toLowerCase())
      if (parentId) {
        edges.push({
          from: { uniqueId: parentId, column: ref.column },
          to: { uniqueId: node.uniqueId, column },
          engine: 'sqlglot',
          sqlSource
        })
      }
    }
  }
  return edges
}

export class DbtColumnLineageService {
  private readonly analyses = new Map<string, NodeAnalysis>()

  constructor(
    private readonly sidecar: DbtSqlglotSidecar,
    private readonly readSql: (
      project: DbtProjectInfo,
      node: DbtManifestNode
    ) => DbtGraphSqlSource | null
  ) {}

  async lineage(
    graph: DbtGraph,
    project: DbtProjectInfo,
    focusNode: DbtGraphNode,
    engineContext: DbtColumnLineageEngineContext,
    request: DbtColumnLineageRequest,
    defaults: DbtColumnLineageDefaults
  ): Promise<DbtColumnLineageResult> {
    const wanted = request.column.trim().toLowerCase()
    const focusColumn = focusNode.columns.find((c) => c.name.toLowerCase() === wanted)
    if (!focusColumn) {
      throw new Error(`${focusNode.name} has no column named "${request.column}".`)
    }
    const depth = clamp(request.depth ?? defaults.depth, 1, DBT_COLUMN_LINEAGE_MAX_PASSES)
    const maxNodes = clamp(request.maxNodes ?? defaults.maxNodes, 2, DBT_GRAPH_MAX_NODES_MAX)
    const hood = selectDbtNeighbourhood(graph.index, focusNode.uniqueId, {
      upstreamDepth: depth,
      downstreamDepth: depth,
      maxNodes
    })
    const status = await this.sidecar.status(engineContext.python, engineContext.env)
    const analyses = await this.analyseNodes(graph, project, hood.nodeIds, engineContext, status)
    const edges = analyses.flatMap((entry) => entry.analysis.edges)
    const propagation = propagateDbtColumnLineage(
      { uniqueId: focusNode.uniqueId, column: focusColumn.name },
      indexDbtColumnEdges(edges),
      depth
    )
    const focusAnalysis = analyses.find((entry) => entry.id === focusNode.uniqueId)?.analysis
    return {
      focus: { uniqueId: focusNode.uniqueId, column: focusColumn.name },
      columns: propagation.columns,
      upstream: propagation.upstream,
      downstream: propagation.downstream,
      engine: focusAnalysis?.engine ?? status.engine,
      ...(status.note ? { engineNote: status.note } : {}),
      nameMatchedNodes: analyses
        .filter((entry) => entry.analysis.engine === 'name-match')
        .map((entry) => entry.id),
      truncated: hood.truncated || propagation.truncated
    }
  }

  private async analyseNodes(
    graph: DbtGraph,
    project: DbtProjectInfo,
    nodeIds: string[],
    engineContext: DbtColumnLineageEngineContext,
    status: DbtLineageEngineStatus
  ): Promise<{ id: string; analysis: NodeAnalysis }[]> {
    const pending: {
      id: string
      key: string
      node: DbtGraphNode
      input: SqlglotNodeInput
      relations: Map<string, string>
      sqlSource: 'compiled' | 'source'
    }[] = []
    const results = new Map<string, NodeAnalysis>()
    for (const id of nodeIds) {
      const node = graph.index.nodes.get(id)
      const manifestNode = graph.manifest.nodes.get(id)
      // Why skip roots: sources and seeds have no SQL and no parents, so nothing to analyse.
      if (!node || !manifestNode || (graph.index.parents.get(id) ?? []).length === 0) {
        continue
      }
      const sql =
        node.resourceType === 'model' || node.resourceType === 'snapshot'
          ? this.readSql(project, manifestNode)
          : null
      if (!sql || status.engine !== 'sqlglot' || !status.python) {
        results.set(id, {
          edges: nameMatchEdges(graph, node),
          engine: 'name-match'
        })
        continue
      }
      const { input, relations } = buildSidecarInput(graph, node, sql)
      const key = analysisKey(id, input)
      const cached = this.analyses.get(key)
      if (cached) {
        results.set(id, cached)
        continue
      }
      pending.push({ id, key, node, input, relations, sqlSource: sql.source })
    }
    if (pending.length > 0) {
      const output = await this.sidecar.analyse(
        status.python as string,
        engineContext.env,
        engineContext.dialect,
        pending.map((entry) => entry.input)
      )
      for (const entry of pending) {
        const nodeOutput = output.ok ? output.nodes[entry.id] : undefined
        const edges = nodeOutput
          ? sidecarEdges(entry.node, nodeOutput, entry.relations, entry.sqlSource)
          : null
        const analysis: NodeAnalysis = edges
          ? { edges, engine: 'sqlglot', sqlSource: entry.sqlSource }
          : { edges: nameMatchEdges(graph, entry.node), engine: 'name-match' }
        // Why cache per node: a parse failure is as stable as the SQL it came from; only a
        // run that produced nothing (python crashed) is retried next time.
        if (output.ok) {
          this.remember(entry.key, analysis)
        }
        results.set(entry.id, analysis)
      }
    }
    return nodeIds.flatMap((id) => {
      const analysis = results.get(id)
      return analysis ? [{ id, analysis }] : []
    })
  }

  private remember(key: string, analysis: NodeAnalysis): void {
    if (this.analyses.size >= 4000) {
      this.analyses.clear()
    }
    this.analyses.set(key, analysis)
  }
}

function analysisKey(id: string, input: SqlglotNodeInput): string {
  return `${id}:${createHash('sha1')
    .update(JSON.stringify([input.sql, input.schema]))
    .digest('hex')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
