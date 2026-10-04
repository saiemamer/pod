import { describe, expect, it } from 'vitest'
import type { DbtGraphColumn } from '../../../../shared/ae/dbt-graph-types'
import {
  LINEAGE_COLUMN_ROWS_MAX,
  lineageExpandedScrollHeight,
  lineageNodeHeight
} from './lineage-layout'
import { lineageNodeRows } from './lineage-node-rows'

const columns = (count: number): DbtGraphColumn[] =>
  Array.from({ length: count }, (_, i) => ({ name: `col_${i}`, source: 'catalog' as const }))
const names = (list: DbtGraphColumn[]): string[] => list.map((column) => column.name)
const NONE: ReadonlySet<string> = new Set()

describe('a node with 500 columns', () => {
  const wide = columns(500)

  it('shows the first few columns and counts the rest', () => {
    const shown = lineageNodeRows(wide, { expanded: false, lit: NONE })
    expect(names(shown.rows)).toEqual(names(wide.slice(0, LINEAGE_COLUMN_ROWS_MAX)))
    expect(shown.hidden).toBe(500 - LINEAGE_COLUMN_ROWS_MAX)
    // The box dagre reserves stays the size of a narrow model's.
    expect(lineageNodeHeight(500, true)).toBe(lineageNodeHeight(LINEAGE_COLUMN_ROWS_MAX + 1, true))
  })

  it('keeps columns on a lit path visible without growing the box', () => {
    const lit = new Set(['col_420', 'col_2'])
    const shown = lineageNodeRows(wide, { expanded: false, lit })
    expect(names(shown.rows)).toContain('col_420')
    expect(names(shown.rows)).toContain('col_2')
    expect(shown.rows).toHaveLength(LINEAGE_COLUMN_ROWS_MAX)
    expect(shown.hidden).toBe(500 - LINEAGE_COLUMN_ROWS_MAX)
    // Model order is kept, so the lit column sits after the others.
    expect(names(shown.rows).at(-1)).toBe('col_420')
  })

  it('shows every lit column even when they outnumber the rows', () => {
    const lit = new Set(columns(9).map((column) => column.name.replace('col_', 'col_4')))
    const shown = lineageNodeRows(wide, { expanded: false, lit })
    expect(shown.rows.filter((column) => lit.has(column.name))).toHaveLength(9)
  })

  it('lists the rest in a bounded scroll area when expanded, lit columns pinned above', () => {
    const lit = new Set(['col_499'])
    const shown = lineageNodeRows(wide, { expanded: true, lit })
    expect(names(shown.pinned)).toEqual(['col_499'])
    expect(shown.rows).toHaveLength(499)
    expect(shown.hidden).toBe(0)
    expect(lineageNodeHeight(500, true, true)).toBeLessThan(400)
    expect(lineageExpandedScrollHeight(500)).toBe(lineageExpandedScrollHeight(5000))
  })

  it('narrows the scroll area by the filter but keeps lit columns pinned', () => {
    const shown = lineageNodeRows(wide, {
      expanded: true,
      lit: new Set(['col_7']),
      filter: ' COL_49 '
    })
    expect(names(shown.pinned)).toEqual(['col_7'])
    expect(names(shown.rows)).toEqual([
      'col_49',
      ...Array.from({ length: 10 }, (_, i) => `col_49${i}`)
    ])
  })
})

it('shows a narrow model whole', () => {
  const narrow = columns(LINEAGE_COLUMN_ROWS_MAX)
  expect(lineageNodeRows(narrow, { expanded: false, lit: NONE })).toEqual({
    pinned: [],
    rows: narrow,
    hidden: 0
  })
})
