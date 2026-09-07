import type { AeDomainConfig, AeInitiative } from '../shared/ae/domain-types'

export type DomainListResult = { domains: AeDomainConfig[]; initiatives: AeInitiative[] }
export type DomainShowResult = { domain: AeDomainConfig; initiatives: AeInitiative[] }

export function formatDomainList(result: DomainListResult): string {
  if (result.domains.length === 0) {
    return 'No domains yet. Open a folder of repos as a project group, then turn it into a domain in Pod.'
  }
  return result.domains
    .map((domain) => {
      const count = result.initiatives.filter(
        (initiative) => initiative.domainId === domain.id
      ).length
      const roles = domain.repos.map((repo) => `${repo.repoId}=${repo.role}`).join(', ')
      return `${domain.name} (${domain.id}) repos: ${roles || 'none'}; initiatives: ${count}`
    })
    .join('\n')
}

export function formatDomainShow(result: DomainShowResult): string {
  const { domain, initiatives } = result
  const lines = [
    `${domain.name} (${domain.id})`,
    `repos: ${domain.repos.map((repo) => `${repo.repoId}=${repo.role}`).join(', ') || 'none'}`,
    `env: ${Object.keys(domain.env).join(', ') || 'none'}`,
    `secrets: ${domain.secretNames.join(', ') || 'none'}`,
    `dbt: ${domain.dbt ? JSON.stringify(domain.dbt) : 'defaults'}`,
    `stakeholder teams: ${domain.stakeholderTeams.join(', ') || 'none'}`,
    `initiatives (${initiatives.length}):`
  ]
  for (const initiative of initiatives) {
    lines.push(
      `  ${initiative.title} [${initiative.status}]${initiative.stakeholderTeam ? ` for ${initiative.stakeholderTeam}` : ''}${initiative.runId ? ` run ${initiative.runId}` : ''} at ${initiative.folderPath}`
    )
  }
  return lines.join('\n')
}
