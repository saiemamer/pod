import { describe, expect, it } from 'vitest'
import {
  dbtModelNameFromPath,
  podDbtErrorMessage,
  podDbtRunLabel,
  podDbtRunTarget
} from './pod-dbt-run-target'

describe('podDbtRunTarget', () => {
  it('runs the model by file name when nothing is selected', () => {
    expect(podDbtRunTarget('/repo/models/marts/fct_orders.sql', null)).toEqual({
      model: 'fct_orders'
    })
    expect(podDbtRunTarget('C:\\repo\\models\\Orders.SQL', '   ')).toEqual({ model: 'Orders' })
    expect(dbtModelNameFromPath('stg_x.sql')).toBe('stg_x')
  })

  it('runs a selection inline, trimmed', () => {
    expect(podDbtRunTarget('/repo/models/a.sql', "  select * from {{ ref('b') }}\n")).toEqual({
      sql: "select * from {{ ref('b') }}"
    })
  })

  it('labels a run by model or by the first line of the selection', () => {
    expect(podDbtRunLabel({ model: 'fct_orders' })).toBe('fct_orders')
    expect(podDbtRunLabel({ sql: 'select 1\nfrom t' })).toBe('select 1')
    expect(podDbtRunLabel({ sql: 'x'.repeat(60) })).toHaveLength(46)
  })

  it('drops the IPC wrapper from error messages', () => {
    expect(
      podDbtErrorMessage(
        new Error("Error invoking remote method 'ae:dbt:show': Error: dbt was not found on PATH.")
      )
    ).toBe('dbt was not found on PATH.')
    expect(podDbtErrorMessage('plain')).toBe('plain')
  })
})
