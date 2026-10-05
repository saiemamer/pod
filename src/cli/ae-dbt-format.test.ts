import { describe, expect, it } from 'vitest'
import type { DbtLineageEntry } from '../shared/ae/dbt-types'
import { formatDbtLineage } from './ae-dbt-format'

const entry = (name: string, depth: number, via: string[]): DbtLineageEntry => ({
  uniqueId: `model.demo.${name}`,
  name,
  resourceType: 'model',
  depth,
  via: via.map((parent) => `model.demo.${parent}`)
})

describe('formatDbtLineage', () => {
  it('prints each node under a parent it has and names its other parents', () => {
    const text = formatDbtLineage({
      model: { uniqueId: 'model.demo.stg', name: 'stg', resourceType: 'model', path: '', tags: [] },
      depth: 2,
      upstream: [],
      downstream: [
        entry('a', 1, ['stg']),
        entry('b', 1, ['stg']),
        entry('a2', 2, ['a']),
        entry('b2', 2, ['b', 'a'])
      ]
    })
    expect(text).toBe(
      [
        'stg (depth 2)',
        'upstream (0):',
        'downstream (4):',
        '  a (model)',
        '    a2 (model)',
        '  b (model)',
        '    b2 (model)  also under: a'
      ].join('\n')
    )
  })
})
