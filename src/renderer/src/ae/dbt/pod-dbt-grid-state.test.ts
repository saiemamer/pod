import { describe, expect, it } from 'vitest'
import {
  clampPodDbtColumnWidth,
  exportablePodDbtRows,
  nextPodDbtSort,
  togglePodDbtHiddenColumn,
  visiblePodDbtRows
} from './pod-dbt-grid-state'

const rows: unknown[][] = [
  [3, 'paid', null],
  [1, 'shipped', 12.5],
  [2, 'Paid', 3.25],
  [null, 'cancelled', 0]
]

describe('results grid state', () => {
  it('cycles a column through ascending, descending and off', () => {
    expect(nextPodDbtSort(null, 1)).toEqual({ column: 1, direction: 'asc' })
    expect(nextPodDbtSort({ column: 1, direction: 'asc' }, 1)).toEqual({
      column: 1,
      direction: 'desc'
    })
    expect(nextPodDbtSort({ column: 1, direction: 'desc' }, 1)).toBeNull()
    expect(nextPodDbtSort({ column: 1, direction: 'desc' }, 0)).toEqual({
      column: 0,
      direction: 'asc'
    })
  })

  it('sorts numbers numerically with NULL last in both directions', () => {
    const none = new Set<number>()
    expect(
      visiblePodDbtRows(rows, {
        search: '',
        sort: { column: 0, direction: 'asc' },
        hiddenColumns: none
      })
    ).toEqual([1, 2, 0, 3])
    expect(
      visiblePodDbtRows(rows, {
        search: '',
        sort: { column: 0, direction: 'desc' },
        hiddenColumns: none
      })
    ).toEqual([0, 2, 1, 3])
    expect(
      visiblePodDbtRows(rows, {
        search: '',
        sort: { column: 2, direction: 'asc' },
        hiddenColumns: none
      })
    ).toEqual([3, 2, 1, 0])
  })

  it('sorts text case-insensitively and keeps the original order when unsorted', () => {
    const none = new Set<number>()
    expect(
      visiblePodDbtRows(rows, {
        search: '',
        sort: { column: 1, direction: 'asc' },
        hiddenColumns: none
      })
    ).toEqual([3, 0, 2, 1])
    expect(visiblePodDbtRows(rows, { search: '', sort: null, hiddenColumns: none })).toEqual([
      0, 1, 2, 3
    ])
  })

  it('searches every shown cell, including NULL by name, and ignores hidden columns', () => {
    expect(
      visiblePodDbtRows(rows, { search: 'PAID', sort: null, hiddenColumns: new Set() })
    ).toEqual([0, 2])
    expect(
      visiblePodDbtRows(rows, { search: 'null', sort: null, hiddenColumns: new Set() })
    ).toEqual([0, 3])
    expect(
      visiblePodDbtRows(rows, { search: 'paid', sort: null, hiddenColumns: new Set([1]) })
    ).toEqual([])
  })

  it('toggles hidden columns and clamps widths', () => {
    const hidden = togglePodDbtHiddenColumn(new Set(), 2)
    expect([...hidden]).toEqual([2])
    expect([...togglePodDbtHiddenColumn(hidden, 2)]).toEqual([])
    expect(clampPodDbtColumnWidth(10)).toBe(60)
    expect(clampPodDbtColumnWidth(5000)).toBe(1200)
    expect(clampPodDbtColumnWidth(140.6)).toBe(141)
  })

  it('exports the shown columns in display order', () => {
    expect(exportablePodDbtRows(['id', 'status', 'amount'], rows, [1, 0], new Set([1]))).toEqual({
      columns: ['id', 'amount'],
      rows: [
        [1, 12.5],
        [3, null]
      ]
    })
  })
})
