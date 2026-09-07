import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { csvCell, csvFileName, toCsv, writeDbtResultsCsv } from './dbt-csv-export'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-csv-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('CSV export', () => {
  it('quotes delimiters, quotes and line breaks and leaves NULL empty', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
    expect(csvCell(12.5)).toBe('12.5')
  })

  it('writes a header and CRLF rows', () => {
    expect(
      toCsv(
        ['id', 'name'],
        [
          [1, 'a'],
          [2, null]
        ]
      )
    ).toBe('id,name\r\n1,a\r\n2,\r\n')
  })

  it('slugs the label into a file name', () => {
    expect(csvFileName('fct_orders')).toBe('fct_orders_results.csv')
    expect(csvFileName("select * from {{ ref('x') }}")).toBe('select_from_ref_x_results.csv')
    expect(csvFileName('   ')).toBe('query_results.csv')
  })

  it('writes under target/', () => {
    const result = writeDbtResultsCsv(
      {
        projectDir: root,
        projectFile: join(root, 'dbt_project.yml'),
        name: 'demo',
        modelPaths: ['models'],
        macroPaths: [],
        targetPath: 'target'
      },
      'orders',
      ['id'],
      [[1], [2]]
    )
    expect(result).toEqual({ file: join(root, 'target', 'orders_results.csv'), rowCount: 2 })
    expect(readFileSync(result.file, 'utf8')).toBe('id\r\n1\r\n2\r\n')
  })
})
