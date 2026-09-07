import type { AeDomainConfig, AeDomainRepo } from '../../../shared/ae/domain-types'

/** Pod: the Domain settings form as plain strings, and the conversions to and from a domain record. */
export type DomainSettingsDraft = {
  name: string
  repos: AeDomainRepo[]
  teamsText: string
  envText: string
  dbtTarget: string
  dbtProfilesDir: string
  /** Empty means Pod's default agent (Claude Code). */
  defaultAgent: string
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `KEY=value` per line; blank lines and `#` comments are skipped, invalid names dropped. */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const key = line.slice(0, separator).trim()
    if (ENV_NAME.test(key)) {
      env[key] = line.slice(separator + 1).trim()
    }
  }
  return env
}

export function formatEnvLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/** One team per line, trimmed, duplicates removed. */
export function parseTeamLines(text: string): string[] {
  const seen = new Set<string>()
  const teams: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const team = raw.trim()
    if (team.length > 0 && !seen.has(team)) {
      seen.add(team)
      teams.push(team)
    }
  }
  return teams
}

export function formatTeamLines(teams: string[]): string {
  return teams.join('\n')
}

/** Seed the form from the saved domain, or from the project group when no domain exists yet. */
export function draftFromDomain(
  domain: AeDomainConfig | null,
  group: { label: string; repoIds: string[] }
): DomainSettingsDraft {
  return {
    name: domain?.name ?? group.label,
    repos: group.repoIds.map((repoId) => ({
      repoId,
      role: domain?.repos.find((entry) => entry.repoId === repoId)?.role ?? 'other'
    })),
    teamsText: formatTeamLines(domain?.stakeholderTeams ?? []),
    envText: formatEnvLines(domain?.env ?? {}),
    dbtTarget: domain?.dbt?.target ?? '',
    dbtProfilesDir: domain?.dbt?.profilesDir ?? '',
    defaultAgent: domain?.defaultAgent ?? ''
  }
}

/** The save payload; undefined fields clear the stored value because the service merges over the existing record. */
export function domainInputFromDraft(
  groupId: string,
  fallbackName: string,
  draft: DomainSettingsDraft
): Partial<AeDomainConfig> & { id: string } {
  const dbtTarget = draft.dbtTarget.trim()
  const dbtProfilesDir = draft.dbtProfilesDir.trim()
  const dbt: AeDomainConfig['dbt'] = {}
  if (dbtTarget) {
    dbt.target = dbtTarget
  }
  if (dbtProfilesDir) {
    dbt.profilesDir = dbtProfilesDir
  }
  return {
    id: groupId,
    name: draft.name.trim() || fallbackName,
    repos: draft.repos,
    stakeholderTeams: parseTeamLines(draft.teamsText),
    env: parseEnvLines(draft.envText),
    dbt: Object.keys(dbt).length > 0 ? dbt : undefined,
    defaultAgent: draft.defaultAgent || undefined
  }
}
