import { describe, expect, it } from 'vitest'
import { findDbtCteDefinition, findDbtRefAtPosition, listDbtRefs } from './dbt-ref-navigation'

describe('what sits under the cursor in a dbt model', () => {
  const line = "    select * from {{ ref('stg_orders') }} join {{ source('raw', 'customers') }} c"

  it('finds a ref() when the cursor is anywhere inside the call', () => {
    const start = line.indexOf('ref(') + 1
    expect(findDbtRefAtPosition(line, start)).toMatchObject({ kind: 'ref', name: 'stg_orders' })
    expect(findDbtRefAtPosition(line, line.indexOf('stg_orders') + 4)).toMatchObject({
      kind: 'ref',
      name: 'stg_orders',
      startColumn: start
    })
    expect(findDbtRefAtPosition('{{ ref("pkg", \'orders\') }}', 12)).toMatchObject({
      kind: 'ref',
      packageName: 'pkg',
      name: 'orders'
    })
  })

  it('finds a source() with both names', () => {
    expect(findDbtRefAtPosition(line, line.indexOf('customers') + 1)).toMatchObject({
      kind: 'source',
      sourceName: 'raw',
      name: 'customers'
    })
    expect(findDbtRefAtPosition("{{ source('raw') }}", 10)).toBeNull()
  })

  it('falls back to the identifier under the cursor', () => {
    expect(findDbtRefAtPosition('    from source_cte s', 12)).toMatchObject({
      kind: 'cte',
      name: 'source_cte',
      startColumn: 10,
      endColumn: 20
    })
    expect(findDbtRefAtPosition('    from x', 2)).toBeNull()
  })

  it('locates a CTE definition by name, one-based', () => {
    const text =
      'with source as (\n    select 1\n),\n\nfinal as (\n    select * from source\n)\nselect * from final'
    expect(findDbtCteDefinition(text, 'source')).toEqual({ lineNumber: 1, column: 6 })
    expect(findDbtCteDefinition(text, 'FINAL')).toEqual({ lineNumber: 5, column: 1 })
    expect(findDbtCteDefinition(text, 'missing')).toBeNull()
  })

  it('lists referenced models once each', () => {
    expect(listDbtRefs("{{ ref('a') }} {{ ref('b') }} {{ ref('a') }} {{ ref('p', 'c') }}")).toEqual(
      ['a', 'b', 'c']
    )
  })
})
