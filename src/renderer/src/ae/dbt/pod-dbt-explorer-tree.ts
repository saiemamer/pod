import type { DbtCatalogRelation, DbtCatalogTree } from '../../../../shared/ae/dbt-graph-types'

/**
 * Pod: the Database explorer's rows. Database > schema > relation > column, flattened
 * for a plain list, with a filter that keeps matching relations and columns together
 * with their ancestors.
 */
export type PodExplorerRow = {
  id: string
  kind: 'database' | 'schema' | 'relation' | 'column'
  depth: number
  label: string
  meta?: string
  expandable: boolean
  expanded: boolean
  relation?: DbtCatalogRelation
}

export function databaseRowId(database: string): string {
  return `db:${database}`
}

export function schemaRowId(database: string, schema: string): string {
  return `schema:${database}.${schema}`
}

/** Every database and schema row id, so the tree opens to the relation level. */
export function defaultExpandedRows(tree: DbtCatalogTree): Set<string> {
  const ids = new Set<string>()
  for (const database of tree.databases) {
    ids.add(databaseRowId(database.name))
    for (const schema of database.schemas) {
      ids.add(schemaRowId(database.name, schema.name))
    }
  }
  return ids
}

export function flattenCatalogTree(
  tree: DbtCatalogTree,
  expanded: Set<string>,
  filter: string
): PodExplorerRow[] {
  const needle = filter.trim().toLowerCase()
  const rows: PodExplorerRow[] = []
  for (const database of tree.databases) {
    const databaseRows: PodExplorerRow[] = []
    for (const schema of database.schemas) {
      const schemaRows: PodExplorerRow[] = []
      for (const relation of schema.relations) {
        const relationMatches = !needle || relation.name.toLowerCase().includes(needle)
        const columns = needle
          ? relation.columns.filter((column) => column.name.toLowerCase().includes(needle))
          : relation.columns
        if (!relationMatches && columns.length === 0) {
          continue
        }
        // Why open on filter: a column hit is only visible if its relation is expanded.
        const relationOpen = needle
          ? !relationMatches || expanded.has(relation.uniqueId)
          : expanded.has(relation.uniqueId)
        schemaRows.push({
          id: relation.uniqueId,
          kind: 'relation',
          depth: 2,
          label: relation.name,
          meta: relation.type ?? relation.resourceType,
          expandable: relation.columns.length > 0,
          expanded: relationOpen,
          relation
        })
        if (relationOpen) {
          for (const column of relationMatches && needle ? relation.columns : columns) {
            schemaRows.push({
              id: `${relation.uniqueId}#${column.name}`,
              kind: 'column',
              depth: 3,
              label: column.name,
              meta: column.type,
              expandable: false,
              expanded: false,
              relation
            })
          }
        }
      }
      if (schemaRows.length === 0) {
        continue
      }
      const schemaId = schemaRowId(database.name, schema.name)
      const schemaOpen = Boolean(needle) || expanded.has(schemaId)
      databaseRows.push({
        id: schemaId,
        kind: 'schema',
        depth: 1,
        label: schema.name,
        meta: String(schema.relations.length),
        expandable: true,
        expanded: schemaOpen
      })
      if (schemaOpen) {
        databaseRows.push(...schemaRows)
      }
    }
    if (databaseRows.length === 0) {
      continue
    }
    const databaseId = databaseRowId(database.name)
    const databaseOpen = Boolean(needle) || expanded.has(databaseId)
    rows.push({
      id: databaseId,
      kind: 'database',
      depth: 0,
      label: database.name,
      meta: String(database.schemas.length),
      expandable: true,
      expanded: databaseOpen
    })
    if (databaseOpen) {
      rows.push(...databaseRows)
    }
  }
  return rows
}
