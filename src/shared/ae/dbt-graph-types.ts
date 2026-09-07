import type { DbtPathRequest } from './dbt-types'

/**
 * Pod: the lineage graph that crosses the process boundary. Built in main from
 * target/manifest.json and target/catalog.json; the canvas, the explorer and
 * `orca dbt lineage | column-lineage` read it. Column values never appear here.
 */
export type DbtGraphColumnSource = 'catalog' | 'manifest' | 'parsed' | 'inherited'

export type DbtGraphColumn = {
  name: string
  dataType?: string
  description?: string
  source: DbtGraphColumnSource
}

export type DbtGraphNode = {
  uniqueId: string
  name: string
  /** model, seed, snapshot or source. */
  resourceType: string
  packageName: string
  /** Path relative to the project, as the manifest records it. */
  path: string
  materialized?: string
  database?: string
  schema?: string
  alias?: string
  description?: string
  columns: DbtGraphColumn[]
  /** Where the column list came from; 'none' when nothing was found. */
  columnSource: DbtGraphColumnSource | 'none'
  /** The final SELECT has a `*` beside named columns, so parents' columns join the list. */
  selectsStar?: boolean
}

/** A dependency: `source` feeds `target` (parent to child). */
export type DbtGraphEdge = { source: string; target: string }

export type DbtGraphRequest = DbtPathRequest & {
  /** Focus model; defaults to the model named after the file in `path`. */
  model?: string
  upstreamDepth?: number
  downstreamDepth?: number
  maxNodes?: number
  refresh?: boolean
}

export type DbtGraphResult = {
  projectDir: string
  focus: string
  nodes: DbtGraphNode[]
  edges: DbtGraphEdge[]
  upstreamDepth: number
  downstreamDepth: number
  /** True when the node cap cut the neighbourhood short. */
  truncated: boolean
  /** Neighbours left out per node, so the canvas can offer to expand further. */
  moreUpstream: Record<string, number>
  moreDownstream: Record<string, number>
  totalNodes: number
  manifestGeneratedAt?: string
  catalogExists: boolean
}

export type DbtColumnRef = { uniqueId: string; column: string }

export type DbtColumnLineageEngine = 'sqlglot' | 'name-match'

/** `from` feeds `to`; `sqlSource` says what the engine read. */
export type DbtColumnLineageEdge = {
  from: DbtColumnRef
  to: DbtColumnRef
  engine: DbtColumnLineageEngine
  sqlSource?: 'compiled' | 'source'
}

export type DbtColumnLineageRequest = DbtPathRequest & {
  model: string
  column: string
  /** Passes in each direction; capped at DBT_COLUMN_LINEAGE_MAX_PASSES. */
  depth?: number
  maxNodes?: number
  refresh?: boolean
}

export type DbtColumnLineageResult = {
  focus: DbtColumnRef
  /** Every column on the path, focus included. */
  columns: DbtColumnRef[]
  upstream: DbtColumnLineageEdge[]
  downstream: DbtColumnLineageEdge[]
  /** The engine that answered for the focus node's own SQL. */
  engine: DbtColumnLineageEngine
  engineNote?: string
  /** Nodes whose SQL the engine could not read, so name matching stood in. */
  nameMatchedNodes: string[]
  truncated: boolean
}

export type DbtLineageEngineStatus = {
  engine: DbtColumnLineageEngine
  python?: string
  pythonSource?: 'settings' | 'path'
  sqlglotVersion?: string
  note?: string
}

export type DbtCatalogColumn = {
  name: string
  type?: string
  index: number
  comment?: string
}

export type DbtCatalogRelation = {
  name: string
  /** table, view, or whatever the warehouse reports. */
  type?: string
  uniqueId: string
  resourceType: string
  /** Model file relative to the project, when the manifest knows the node. */
  path?: string
  comment?: string
  columns: DbtCatalogColumn[]
}

export type DbtCatalogSchema = {
  name: string
  relations: DbtCatalogRelation[]
}
export type DbtCatalogDatabase = { name: string; schemas: DbtCatalogSchema[] }

export type DbtCatalogTree = {
  projectDir: string
  file: string
  exists: boolean
  generatedAt?: string
  databases: DbtCatalogDatabase[]
  relationCount: number
}

export const DBT_GRAPH_MAX_NODES_MAX = 5000
export const DBT_COLUMN_LINEAGE_MAX_PASSES = 16
export const DBT_COLUMN_INHERIT_MAX_PASSES = 10
