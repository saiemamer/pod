import { describe, expect, it } from 'vitest'
import {
  domainInputFromDraft,
  draftFromDomain,
  formatEnvLines,
  parseEnvLines,
  parseTeamLines
} from './domain-settings-form'
import type { AeDomainConfig } from '../../../shared/ae/domain-types'

describe('domain settings form', () => {
  it('parses KEY=value lines and skips comments, blanks and bad names', () => {
    expect(
      parseEnvLines('OMNI_BASE_URL=https://x\n# note\n\nbad-name=1\n=nope\nDBT_TARGET = prod ')
    ).toEqual({
      OMNI_BASE_URL: 'https://x',
      DBT_TARGET: 'prod'
    })
  })

  it('keeps the first = as the separator so values may contain =', () => {
    expect(parseEnvLines('TOKEN=a=b')).toEqual({ TOKEN: 'a=b' })
    expect(formatEnvLines({ TOKEN: 'a=b' })).toBe('TOKEN=a=b')
  })

  it('dedupes stakeholder teams', () => {
    expect(parseTeamLines('Channels\n Channels \nDev-rel\n')).toEqual(['Channels', 'Dev-rel'])
  })

  it('seeds every group repo, keeping saved roles and defaulting the rest to other', () => {
    const domain: AeDomainConfig = {
      id: 'g1',
      name: 'MEX',
      repos: [{ repoId: 'r1', role: 'dbt' }],
      env: {},
      secretNames: [],
      stakeholderTeams: ['Channels'],
      createdAt: 1,
      updatedAt: 1
    }
    const draft = draftFromDomain(domain, { label: 'group', repoIds: ['r1', 'r2'] })
    expect(draft.name).toBe('MEX')
    expect(draft.repos).toEqual([
      { repoId: 'r1', role: 'dbt' },
      { repoId: 'r2', role: 'other' }
    ])
    expect(draftFromDomain(null, { label: 'group', repoIds: [] }).name).toBe('group')
  })

  it('clears dbt defaults and the default agent when the fields are empty', () => {
    const input = domainInputFromDraft('g1', 'group', {
      name: ' ',
      repos: [],
      teamsText: '',
      envText: '',
      dbtTarget: '',
      dbtProfilesDir: '',
      defaultAgent: ''
    })
    expect(input).toEqual({
      id: 'g1',
      name: 'group',
      repos: [],
      stakeholderTeams: [],
      env: {},
      dbt: undefined,
      defaultAgent: undefined
    })
    expect(
      domainInputFromDraft('g1', 'group', {
        name: 'MEX',
        repos: [],
        teamsText: '',
        envText: '',
        dbtTarget: 'prod',
        dbtProfilesDir: '',
        defaultAgent: 'codex'
      })
    ).toMatchObject({ dbt: { target: 'prod' }, defaultAgent: 'codex' })
  })
})
