import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AE_DBT_SETTINGS,
  normalizeAeDbtSettings,
  normalizeAeToolCmdOverrides
} from './dbt-settings-types'

describe('normalizeAeDbtSettings', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(normalizeAeDbtSettings(undefined)).toEqual(DEFAULT_AE_DBT_SETTINGS)
    expect(normalizeAeDbtSettings('x')).toEqual(DEFAULT_AE_DBT_SETTINGS)
  })

  it('clamps numbers, validates the distribution and trims paths', () => {
    const settings = normalizeAeDbtSettings({
      showLimit: 9999,
      lineageDepth: 0,
      distribution: 'fusion',
      coreAdapter: '',
      target: ' prod ',
      profilesDir: '   ',
      env: { DBT_ENV: 'ci', 'bad-key': 'x' },
      parseOnLoad: false
    })
    expect(settings).toMatchObject({
      showLimit: 500,
      lineageDepth: 1,
      distribution: 'fusion',
      coreAdapter: 'bigquery',
      target: 'prod',
      env: { DBT_ENV: 'ci' },
      parseOnLoad: false
    })
    expect(settings.profilesDir).toBeUndefined()
  })
})

describe('normalizeAeToolCmdOverrides', () => {
  it('keeps only known tools with non-empty paths', () => {
    expect(
      normalizeAeToolCmdOverrides({ dbt: '/opt/venv/bin/dbt', omni: '', python: 7, rm: '/bin/rm' })
    ).toEqual({ dbt: '/opt/venv/bin/dbt' })
    expect(normalizeAeToolCmdOverrides(null)).toEqual({})
  })
})
