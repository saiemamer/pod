import { describe, expect, it } from 'vitest'
import type { AeDomainConfig, AeInitiative } from '../shared/ae/domain-types'
import { formatDomainShow } from './ae-domain-format'

describe('formatDomainShow', () => {
  it("names each initiative's own repos, not the whole domain's", () => {
    const domain: AeDomainConfig = {
      id: 'g1',
      name: 'Analytics',
      repos: [
        { repoId: 'dbt-demo', role: 'dbt' },
        { repoId: 'omni-demo', role: 'omni' }
      ],
      env: {},
      secretNames: [],
      stakeholderTeams: [],
      createdAt: 0,
      updatedAt: 0
    }
    const initiative: AeInitiative = {
      id: 'i1',
      domainId: 'g1',
      title: 'Real agent check',
      slug: 'real-agent-check',
      folderPath: '/tmp/real-agent-check',
      repoIds: ['dbt-demo'],
      status: 'planning',
      createdAt: 0,
      updatedAt: 0
    }
    const text = formatDomainShow({ domain, initiatives: [initiative] })
    expect(text).toContain('Real agent check [planning] repos: dbt-demo at /tmp/real-agent-check')
  })
})
