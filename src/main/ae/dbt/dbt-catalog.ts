import { readFileSync, statSync } from 'node:fs'
import type {
  DbtCatalogColumn,
  DbtCatalogDatabase,
  DbtCatalogRelation,
  DbtCatalogTree
} from '../../../shared/ae/dbt-graph-types'
import type { DbtManifest } from './dbt-manifest'

/**
 * Pod: the whole of target/catalog.json, for the explorer tree and the lineage graph's
 * column lists. Cached by mtime like the manifest; a 2,000-relation catalog is a few
 * megabytes, which is fine to hold once but not to re-read on every click.
 */
export type DbtCatalogNode = {
  uniqueId: string
  database?: string
  schema?: string
  name: string
  type?: string
  comment?: string
  columns: DbtCatalogColumn[]
}

export type DbtCatalog = {
  file: string
  mtimeMs: number
  generatedAt?: string
  nodes: Map<string, DbtCatalogNode>
}

const cache = new Map<string, DbtCatalog>()

export function loadDbtCatalog(file: string): DbtCatalog | null {
  let mtimeMs: number
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    cache.delete(file)
    return null
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached
  }
  const parsed = parseDbtCatalog(file, readFileSync(file, 'utf8'), mtimeMs)
  if (parsed) {
    cache.set(file, parsed)
  }
  return parsed
}

export function parseDbtCatalog(file: string, text: string, mtimeMs = 0): DbtCatalog | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) {
    return null
  }
  const nodes = new Map<string, DbtCatalogNode>()
  for (const bucket of ['nodes', 'sources']) {
    const entries = isRecord(raw[bucket]) ? raw[bucket] : {}
    for (const [uniqueId, entry] of Object.entries(entries)) {
      const node = toCatalogNode(uniqueId, entry)
      if (node) {
        nodes.set(uniqueId, node)
      }
    }
  }
  const metadata = isRecord(raw.metadata) ? raw.metadata : {}
  return {
    file,
    mtimeMs,
    generatedAt: optionalString(metadata.generated_at),
    nodes
  }
}

function toCatalogNode(uniqueId: string, entry: unknown): DbtCatalogNode | null {
  if (!isRecord(entry)) {
    return null
  }
  const metadata = isRecord(entry.metadata) ? entry.metadata : {}
  const name = optionalString(metadata.name) ?? uniqueId.split('.').at(-1) ?? uniqueId
  const columns: DbtCatalogColumn[] = []
  const rawColumns = isRecord(entry.columns) ? entry.columns : {}
  for (const [key, column] of Object.entries(rawColumns)) {
    const record = isRecord(column) ? column : {}
    columns.push({
      name: optionalString(record.name) ?? key,
      type: optionalString(record.type),
      index: typeof record.index === 'number' ? record.index : columns.length + 1,
      comment: optionalString(record.comment)
    })
  }
  columns.sort((a, b) => a.index - b.index)
  return {
    uniqueId,
    database: optionalString(metadata.database),
    schema: optionalString(metadata.schema),
    name,
    type: optionalString(metadata.type),
    comment: optionalString(metadata.comment),
    columns
  }
}

/** Database > schema > relation, sorted by name; the manifest supplies resource types. */
export function buildDbtCatalogTree(
  projectDir: string,
  file: string,
  catalog: DbtCatalog | null,
  manifest: DbtManifest | null
): DbtCatalogTree {
  if (!catalog) {
    return { projectDir, file, exists: false, databases: [], relationCount: 0 }
  }
  const databases = new Map<string, Map<string, DbtCatalogRelation[]>>()
  let relationCount = 0
  for (const node of catalog.nodes.values()) {
    const database = node.database ?? ''
    const schema = node.schema ?? ''
    const schemas = databases.get(database) ?? new Map<string, DbtCatalogRelation[]>()
    databases.set(database, schemas)
    const relations = schemas.get(schema) ?? []
    schemas.set(schema, relations)
    const manifestNode = manifest?.nodes.get(node.uniqueId)
    relations.push({
      name: node.name,
      type: node.type,
      uniqueId: node.uniqueId,
      resourceType: manifestNode?.resourceType ?? node.uniqueId.split('.')[0] ?? 'model',
      ...(manifestNode?.originalFilePath ? { path: manifestNode.originalFilePath } : {}),
      comment: node.comment,
      columns: node.columns
    })
    relationCount += 1
  }
  const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)
  const tree: DbtCatalogDatabase[] = [...databases.entries()]
    .map(([name, schemas]) => ({
      name,
      schemas: [...schemas.entries()]
        .map(([schemaName, relations]) => ({
          name: schemaName,
          relations: relations.sort(byName)
        }))
        .sort(byName)
    }))
    .sort(byName)
  return {
    projectDir,
    file,
    exists: true,
    generatedAt: catalog.generatedAt,
    databases: tree,
    relationCount
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
