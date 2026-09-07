/**
 * Pod: pure helpers behind the results grid's toolbar. Rows stay untouched; the grid
 * shows an index list, so sort, search and hidden columns compose without copying cells.
 */
export type PodDbtSort = { column: number; direction: 'asc' | 'desc' } | null

export function nextPodDbtSort(current: PodDbtSort, column: number): PodDbtSort {
  if (!current || current.column !== column) {
    return { column, direction: 'asc' }
  }
  return current.direction === 'asc' ? { column, direction: 'desc' } : null
}

function compareCells(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull || bNull) {
    // Why: NULL sorts last in both directions, as warehouses do by default for ASC.
    return aNull && bNull ? 0 : aNull ? 1 : -1
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b)
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Row indexes in display order: filtered by the search text, then sorted. */
export function visiblePodDbtRows(
  rows: unknown[][],
  options: { search: string; sort: PodDbtSort; hiddenColumns: ReadonlySet<number> }
): number[] {
  const needle = options.search.trim().toLowerCase()
  let indexes = rows.map((_, index) => index)
  if (needle) {
    indexes = indexes.filter((index) =>
      rows[index].some(
        (cell, column) =>
          !options.hiddenColumns.has(column) && cellSearchText(cell).includes(needle)
      )
    )
  }
  const sort = options.sort
  if (sort) {
    const sign = sort.direction === 'asc' ? 1 : -1
    indexes = [...indexes].sort((left, right) => {
      const order = compareCells(rows[left][sort.column], rows[right][sort.column])
      // Why: NULLs stay last when descending too, so the sign only flips real values.
      const leftNull = rows[left][sort.column] === null || rows[left][sort.column] === undefined
      const rightNull = rows[right][sort.column] === null || rows[right][sort.column] === undefined
      return leftNull || rightNull ? order : order * sign
    })
  }
  return indexes
}

function cellSearchText(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  return (typeof value === 'object' ? JSON.stringify(value) : String(value)).toLowerCase()
}

export function togglePodDbtHiddenColumn(hidden: ReadonlySet<number>, column: number): Set<number> {
  const next = new Set(hidden)
  if (next.has(column)) {
    next.delete(column)
  } else {
    next.add(column)
  }
  return next
}

export const POD_DBT_MIN_COL_PX = 60
export const POD_DBT_MAX_COL_PX = 1200

export function clampPodDbtColumnWidth(width: number): number {
  return Math.min(POD_DBT_MAX_COL_PX, Math.max(POD_DBT_MIN_COL_PX, Math.round(width)))
}

/** The columns and rows the export writes: hidden columns dropped, display order kept. */
export function exportablePodDbtRows(
  columns: string[],
  rows: unknown[][],
  order: number[],
  hiddenColumns: ReadonlySet<number>
): { columns: string[]; rows: unknown[][] } {
  const keep = columns.map((_, index) => index).filter((index) => !hiddenColumns.has(index))
  return {
    columns: keep.map((index) => columns[index]),
    rows: order.map((rowIndex) => keep.map((index) => rows[rowIndex][index]))
  }
}
