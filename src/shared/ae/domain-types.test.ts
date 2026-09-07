import { describe, expect, it } from 'vitest'
import {
  aeDomainSecretKey,
  aeInitiativeSlug,
  normalizeAeDomains,
  normalizeAeInitiatives
} from './domain-types'

describe('normalizeAeDomains', () => {
  it('keeps well-formed domains and fills defaults', () => {
    const domains = normalizeAeDomains({
      g1: {
        id: 'g1',
        name: 'MEX',
        repos: [
          { repoId: 'r-dbt', role: 'dbt' },
          { repoId: 'r-omni', role: 'omni' },
          { repoId: 'r-infra', role: 'nonsense' },
          { role: 'dbt' }
        ],
        env: { DBT_TARGET: 'dev', 'bad key': 'x', NUM: 3 },
        secretNames: ['OMNI_API_KEY', 7],
        stakeholderTeams: ['Channels'],
        dbt: { target: 'dev', profilesDir: '' },
        createdAt: 1,
        updatedAt: 2
      }
    })
    expect(domains.g1).toEqual({
      id: 'g1',
      name: 'MEX',
      repos: [
        { repoId: 'r-dbt', role: 'dbt' },
        { repoId: 'r-omni', role: 'omni' },
        { repoId: 'r-infra', role: 'other' }
      ],
      env: { DBT_TARGET: 'dev' },
      secretNames: ['OMNI_API_KEY'],
      stakeholderTeams: ['Channels'],
      dbt: { target: 'dev' },
      createdAt: 1,
      updatedAt: 2
    })
  })

  it('uses the map key as the id and drops garbage', () => {
    const domains = normalizeAeDomains({ g2: { name: 'Commerce' }, g3: 'nope', g4: null })
    expect(Object.keys(domains)).toEqual(['g2'])
    expect(domains.g2.name).toBe('Commerce')
    expect(domains.g2.repos).toEqual([])
    expect(normalizeAeDomains(undefined)).toEqual({})
    expect(normalizeAeDomains([1, 2])).toEqual({})
  })
})

describe('normalizeAeInitiatives', () => {
  it('requires id, domainId and folderPath, dedupes ids and defaults the status', () => {
    const initiatives = normalizeAeInitiatives([
      {
        id: 'i1',
        domainId: 'g1',
        folderPath: '/x/initiatives/opencx',
        title: 'OpenCX',
        status: 'weird'
      },
      { id: 'i1', domainId: 'g1', folderPath: '/dup' },
      { id: 'i2', domainId: 'g1' },
      {
        id: 'i3',
        domainId: 'g1',
        folderPath: '/y',
        status: 'done',
        runId: 'run-1',
        stakeholderTeam: 'Channels'
      }
    ])
    expect(initiatives.map((initiative) => initiative.id)).toEqual(['i1', 'i3'])
    expect(initiatives[0].status).toBe('planning')
    expect(initiatives[0].slug).toBe('i1')
    expect(initiatives[1]).toMatchObject({
      status: 'done',
      runId: 'run-1',
      stakeholderTeam: 'Channels'
    })
    expect(normalizeAeInitiatives({})).toEqual([])
  })
})

describe('helpers', () => {
  it('builds secret keys and slugs', () => {
    expect(aeDomainSecretKey('g1', 'OMNI_API_KEY')).toBe('ae-domain:g1:OMNI_API_KEY')
    expect(aeInitiativeSlug('OpenCX migration (Support Optimisation)')).toBe(
      'opencx-migration-support-optimisation'
    )
    expect(aeInitiativeSlug('   ')).toBe('initiative')
  })
})
