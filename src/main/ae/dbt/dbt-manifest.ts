import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DbtProjectInfo } from './dbt-project-discovery'

/**
 * Pod: a slim view of target/manifest.json. Enough for the CLI (list, info, lineage)
 * and for finding a model's compiled file; compiled code stays on disk, because a
 * 2,000-model manifest already costs tens of megabytes as JSON.
 */
export type DbtManifestColumn = {
  name: string
  description?: string
  dataType?: string
}

export type DbtManifestNode = {
  uniqueId: string
  name: string
  resourceType: string
  packageName: string
  path: string
  originalFilePath: string
  database?: string
  schema?: string
  alias?: string
  /** Sources name their table with `identifier`; models use `alias`. */
  identifier?: string
  /** The warehouse name dbt renders, quotes included, e.g. `proj`.`dbt`.`orders`. */
  relationName?: string
  description?: string
  materialized?: string
  tags: string[]
  columns: DbtManifestColumn[]
  dependsOn: string[]
}

export type DbtManifest = {
  file: string
  mtimeMs: number
  generatedAt?: string
  dbtVersion?: string
  projectName?: string
  nodes: Map<string, DbtManifestNode>
  parentMap: Record<string, string[]>
  childMap: Record<string, string[]>
}

export const DBT_MANIFEST_FILE = 'manifest.json'
export const DBT_LINEAGE_NODE_TYPES = new Set(['model', 'seed', 'snapshot', 'source'])

export function dbtManifestPath(project: DbtProjectInfo): string {
  return join(project.projectDir, project.targetPath, DBT_MANIFEST_FILE)
}

const cache = new Map<string, DbtManifest>()

/** Re-reads when the file's mtime moved; returns null when there is no manifest yet. */
export function loadDbtManifest(file: string): DbtManifest | null {
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
  const parsed = parseDbtManifest(file, readFileSync(file, 'utf8'), mtimeMs)
  if (parsed) {
    cache.set(file, parsed)
  }
  return parsed
}

export function parseDbtManifest(file: string, text: string, mtimeMs = 0): DbtManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) {
    return null
  }
  const nodes = new Map<string, DbtManifestNode>()
  for (const bucket of ['nodes', 'sources']) {
    const entries = isRecord(raw[bucket]) ? (raw[bucket] as Record<string, unknown>) : {}
    for (const [uniqueId, entry] of Object.entries(entries)) {
      const node = toNode(uniqueId, entry)
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
    dbtVersion: optionalString(metadata.dbt_version),
    projectName: optionalString(metadata.project_name),
    nodes,
    parentMap: toIdMap(raw.parent_map),
    childMap: toIdMap(raw.child_map)
  }
}

/** Models first, then any node whose name matches, then a full unique id. */
export function findDbtManifestNode(manifest: DbtManifest, name: string): DbtManifestNode | null {
  const wanted = name.trim()
  if (manifest.nodes.has(wanted)) {
    return manifest.nodes.get(wanted) ?? null
  }
  let fallback: DbtManifestNode | null = null
  for (const node of manifest.nodes.values()) {
    if (node.name !== wanted) {
      continue
    }
    if (node.resourceType === 'model') {
      return node
    }
    fallback ??= node
  }
  return fallback
}

export function listDbtManifestModels(manifest: DbtManifest, filter?: string): DbtManifestNode[] {
  const needle = filter?.trim().toLowerCase()
  return [...manifest.nodes.values()]
    .filter((node) => node.resourceType === 'model')
    .filter((node) => !needle || node.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type DbtLineageEntry = {
  uniqueId: string
  name: string
  resourceType: string
  depth: number
}

/** Breadth-first walk over parent_map or child_map, capped by depth. */
export function walkDbtLineage(
  manifest: DbtManifest,
  uniqueId: string,
  direction: 'upstream' | 'downstream',
  maxDepth: number
): DbtLineageEntry[] {
  const edges = direction === 'upstream' ? manifest.parentMap : manifest.childMap
  const seen = new Set<string>([uniqueId])
  const out: DbtLineageEntry[] = []
  let frontier = [uniqueId]
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbour of edges[id] ?? []) {
        if (seen.has(neighbour)) {
          continue
        }
        seen.add(neighbour)
        const node = manifest.nodes.get(neighbour)
        if (!node || !DBT_LINEAGE_NODE_TYPES.has(node.resourceType)) {
          continue
        }
        out.push({
          uniqueId: neighbour,
          name: node.name,
          resourceType: node.resourceType,
          depth
        })
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return out
}

function toNode(uniqueId: string, entry: unknown): DbtManifestNode | null {
  if (!isRecord(entry)) {
    return null
  }
  const resourceType = optionalString(entry.resource_type)
  const name = optionalString(entry.name)
  if (!resourceType || !name) {
    return null
  }
  const config = isRecord(entry.config) ? entry.config : {}
  const dependsOn = isRecord(entry.depends_on) ? entry.depends_on : {}
  return {
    uniqueId,
    name,
    resourceType,
    packageName: optionalString(entry.package_name) ?? '',
    path: optionalString(entry.path) ?? '',
    originalFilePath: optionalString(entry.original_file_path) ?? '',
    database: optionalString(entry.database),
    schema: optionalString(entry.schema),
    alias: optionalString(entry.alias),
    identifier: optionalString(entry.identifier),
    relationName: optionalString(entry.relation_name),
    description: optionalString(entry.description),
    materialized: optionalString(config.materialized),
    tags: stringArray(entry.tags),
    columns: toColumns(entry.columns),
    dependsOn: stringArray(dependsOn.nodes)
  }
}

function toColumns(value: unknown): DbtManifestColumn[] {
  if (!isRecord(value)) {
    return []
  }
  const columns: DbtManifestColumn[] = []
  for (const [key, entry] of Object.entries(value)) {
    const record = isRecord(entry) ? entry : {}
    columns.push({
      name: optionalString(record.name) ?? key,
      description: optionalString(record.description),
      dataType: optionalString(record.data_type)
    })
  }
  return columns
}

function toIdMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {}
  }
  const map: Record<string, string[]> = {}
  for (const [key, entry] of Object.entries(value)) {
    map[key] = stringArray(entry)
  }
  return map
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}
