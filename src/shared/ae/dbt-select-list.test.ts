import { describe, expect, it } from 'vitest'
import {
  dbtRelationIdentifier,
  parseDbtSelectList,
  selectEntryName,
  stripDbtJinja
} from './dbt-select-list'

describe('stripDbtJinja', () => {
  it('replaces ref and source with identifiers and records them once', () => {
    const { sql, refs } = stripDbtJinja(
      "{{ config(materialized='table') }}\nselect a from {{ ref('stg_a') }} join {{ ref('pkg', 'stg_b') }} using (id) join {{ source('raw', 'events') }} e using (id) where x = {{ var('cutoff') }} and y in {{ ref('stg_a') }}"
    )
    expect(sql).toBe(
      'select a from stg_a join stg_b using (id) join raw__events e using (id) where x = NULL and y in stg_a'
    )
    expect(refs).toEqual([
      { kind: 'ref', name: 'stg_a' },
      { kind: 'ref', packageName: 'pkg', name: 'stg_b' },
      { kind: 'source', sourceName: 'raw', tableName: 'events' }
    ])
    expect(refs.map(dbtRelationIdentifier)).toEqual(['stg_a', 'stg_b', 'raw__events'])
  })

  it('drops statements and comments', () => {
    const { sql } = stripDbtJinja(
      "{# note #}{% set cols = ['a'] %}select {% for c in cols %}{{ c }}{% endfor %} from t"
    )
    expect(sql).toBe('select NULL from t')
  })
})

describe('selectEntryName', () => {
  it.each([
    ['order_id', 'order_id'],
    ['o.order_id', 'order_id'],
    ['upper(status) as status_up', 'status_up'],
    ['sum(amount) total', 'total'],
    ['`quoted col` as `out`', 'out'],
    ['cast(x as string) as x_text', 'x_text'],
    ['case when a then 1 else 0 end as flag', 'flag'],
    ['case when a then 1 else 0 end flag', 'flag'],
    ['count(*)', null],
    ['*', null],
    ['t.*', null],
    ["'lit'", null]
  ])('%s -> %s', (entry, name) => {
    expect(selectEntryName(entry)).toBe(name)
  })
})

describe('parseDbtSelectList', () => {
  it('reads the final select after CTEs and skips stars', () => {
    const sql = `with source as (select * from stg), final as (
      select order_id, status, amount * 2 as double_amount, -- trailing, comment
      coalesce(a, b) as picked from source where status != 'x')
    select order_id, status, double_amount, picked from final`
    expect(parseDbtSelectList(sql)).toEqual({
      columns: ['order_id', 'status', 'double_amount', 'picked'],
      hasStar: false
    })
  })

  it('flags a star and keeps named columns beside it', () => {
    expect(parseDbtSelectList('select *, 1 as one from t')).toEqual({
      columns: ['one'],
      hasStar: true
    })
    expect(parseDbtSelectList('select * from final')).toEqual({
      columns: [],
      hasStar: true
    })
  })

  it('handles distinct, subqueries and no from', () => {
    expect(parseDbtSelectList('select distinct a, (select max(b) from t) as mb from x')).toEqual({
      columns: ['a', 'mb'],
      hasStar: false
    })
    expect(parseDbtSelectList('select 1 as n')).toEqual({
      columns: ['n'],
      hasStar: false
    })
    expect(parseDbtSelectList('')).toEqual({ columns: [], hasStar: false })
  })
})
