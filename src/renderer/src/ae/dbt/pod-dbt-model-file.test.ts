import { describe, expect, it } from 'vitest'
import { isDbtModelFile } from './pod-dbt-model-file'

const project = { projectDir: '/repo/analytics', modelPaths: ['models', 'marts/'] }

describe('isDbtModelFile', () => {
  it('offers lineage for a .sql file under any model-path', () => {
    expect(isDbtModelFile('/repo/analytics/models/staging/stg_orders.sql', project)).toBe(true)
    expect(isDbtModelFile('/repo/analytics/marts/orders.sql', project)).toBe(true)
  })

  it('does not offer it for other files in the project', () => {
    expect(isDbtModelFile('/repo/analytics/models/schema.yml', project)).toBe(false)
    expect(isDbtModelFile('/repo/analytics/macros/cents.sql', project)).toBe(false)
    expect(isDbtModelFile('/repo/analytics/analyses/adhoc.sql', project)).toBe(false)
    // A sibling folder that only shares the prefix is not the model-path.
    expect(isDbtModelFile('/repo/analytics/models_old/orders.sql', project)).toBe(false)
  })

  it('reads Windows paths', () => {
    expect(
      isDbtModelFile('C:\\repo\\models\\orders.sql', {
        projectDir: 'C:\\repo',
        modelPaths: ['models']
      })
    ).toBe(true)
  })
})
