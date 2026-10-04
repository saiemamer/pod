import type { DbtGraphColumn } from '../../../../shared/ae/dbt-graph-types'
import { LINEAGE_COLUMN_ROWS_MAX } from './lineage-layout'

export type LineageNodeRows = {
  /** Lit columns held above an expanded node's scroll area, so scrolling never hides them. */
  pinned: DbtGraphColumn[]
  /** The rows shown; inside the scroll area when expanded. */
  rows: DbtGraphColumn[]
  /** Columns left out of a collapsed node, for "+n more". */
  hidden: number
}

/**
 * Pod: which column rows a node renders. Collapsed, the first few in model order, with
 * every lit column swapped in for an unlit one so the box keeps its height and the
 * path stays visible. Expanded, the lit columns pinned on top and the rest, narrowed
 * by the filter, in the scroll area.
 */
export function lineageNodeRows(
  columns: DbtGraphColumn[],
  options: { expanded: boolean; lit: ReadonlySet<string>; filter?: string }
): LineageNodeRows {
  const { expanded, lit } = options
  const isLit = (column: DbtGraphColumn): boolean => lit.has(column.name.toLowerCase())
  if (columns.length <= LINEAGE_COLUMN_ROWS_MAX) {
    return { pinned: [], rows: columns, hidden: 0 }
  }
  if (expanded) {
    const filter = (options.filter ?? '').trim().toLowerCase()
    return {
      pinned: columns.filter(isLit),
      rows: columns.filter(
        (column) => !isLit(column) && (!filter || column.name.toLowerCase().includes(filter))
      ),
      hidden: 0
    }
  }
  const litCount = columns.filter(isLit).length
  let unlitRoom = Math.max(0, LINEAGE_COLUMN_ROWS_MAX - litCount)
  const rows = columns.filter((column) => {
    if (isLit(column)) {
      return true
    }
    if (unlitRoom > 0) {
      unlitRoom -= 1
      return true
    }
    return false
  })
  return { pinned: [], rows, hidden: columns.length - rows.length }
}
