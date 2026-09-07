import { describe, expect, it } from 'vitest'
import {
  collectDbtJsonLogErrors,
  parseDbtCompiledFromJsonLogs,
  parseDbtCompiledFromTextLogs,
  parseDbtShowOutput
} from './dbt-show-output'

describe('parseDbtShowOutput', () => {
  it('reads dbt Core output, keeping column order and filling missing cells with null', () => {
    const table = parseDbtShowOutput(
      '12:00:01  Running with dbt=1.9.0\n{"show": [{"id": 1, "name": "a"}, {"id": 2, "extra": true}]}\n'
    )
    expect(table).toEqual({
      columns: ['id', 'name', 'extra'],
      rows: [
        [1, 'a', null],
        [2, null, true]
      ],
      rowCount: 2,
      source: 'core'
    })
  })

  it('reads dbt Fusion output, which is a bare array', () => {
    expect(parseDbtShowOutput('[{"n": 3}]')).toEqual({
      columns: ['n'],
      rows: [[3]],
      rowCount: 1,
      source: 'fusion'
    })
  })

  it('returns null for text that holds no rows', () => {
    expect(parseDbtShowOutput('Compilation Error in model x')).toBeNull()
    expect(parseDbtShowOutput('')).toBeNull()
    expect(parseDbtShowOutput('{"show": "not rows"}')).toBeNull()
  })
})

describe('compile output parsers', () => {
  it('takes the SQL from the CompiledNode JSON event', () => {
    const stdout = [
      '{"data": {"log_version": 3}, "info": {"name": "MainReportVersion", "level": "info", "msg": "Running"}}',
      '{"data": {"node_name": "orders", "compiled": "select 1 as one", "is_inline": false}, "info": {"name": "CompiledNode", "level": "info", "msg": "Compiled node"}}'
    ].join('\n')
    expect(parseDbtCompiledFromJsonLogs(stdout)).toBe('select 1 as one')
    expect(parseDbtCompiledFromJsonLogs('not json')).toBeNull()
  })

  it('falls back to the text banner and stops at the next log line', () => {
    const stdout = [
      '12:00:01  Running with dbt=1.9.0',
      "12:00:02  Compiled node 'orders' is:",
      'select 1',
      'from t',
      '12:00:03  Done.'
    ].join('\n')
    expect(parseDbtCompiledFromTextLogs(stdout)).toBe('select 1\nfrom t')
    expect(parseDbtCompiledFromTextLogs('12:00:01  Running')).toBeNull()
  })

  it('collects error-level messages from JSON logs', () => {
    const stdout = [
      '{"info": {"level": "info", "msg": "fine"}}',
      '{"info": {"level": "error", "msg": "Compilation Error in model bad"}}',
      '{broken'
    ].join('\n')
    expect(collectDbtJsonLogErrors(stdout)).toEqual(['Compilation Error in model bad'])
  })
})
