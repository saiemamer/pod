import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Repo } from '../../shared/repo-types'
import type {
  AeDomainConfig,
  AeDomainRepo,
  AeInitiative,
  AeRepoRole
} from '../../shared/ae/domain-types'
import { aeInitiativeSlug, normalizeAeDomain } from '../../shared/ae/domain-types'
import { getSecretStore } from '../../shared/secret-store'
import { detectAeRepoRole } from './domain-repo-role'

/**
 * Pod: one owner for domain data so IPC, the CLI's RPC methods and agent launch share a
 * code path. Installed once from the repo IPC registration, which is where the store and
 * runtime are both in hand.
 */
export type AeDomainSaveInput = Partial<AeDomainConfig> & { id: string }

export type AeInitiativeSaveInput = Partial<AeInitiative> & { domainId: string; title: string }

export class AeDomainService {
  constructor(
    private readonly store: Store,
    private readonly runtime: OrcaRuntimeService
  ) {}

  listDomains(): AeDomainConfig[] {
    return Object.values(this.store.getAeDomains()).sort((a, b) => a.name.localeCompare(b.name))
  }

  getDomain(domainId: string): AeDomainConfig | null {
    return this.store.getAeDomain(domainId)
  }

  /** Why the group check: a domain is a project group plus Pod data, never a free-floating record. */
  saveDomain(input: AeDomainSaveInput): AeDomainConfig {
    const group = this.store.getProjectGroups().find((entry) => entry.id === input.id)
    if (!group) {
      throw new Error(`Project group "${input.id}" not found`)
    }
    const existing = this.store.getAeDomain(input.id)
    const merged = normalizeAeDomain(
      {
        ...existing,
        ...input,
        id: input.id,
        name: input.name ?? existing?.name ?? group.name,
        repos: input.repos ?? existing?.repos ?? this.detectRoles(input.id),
        createdAt: existing?.createdAt ?? Date.now()
      },
      input.id
    )
    if (!merged) {
      throw new Error('Invalid domain')
    }
    return this.store.saveAeDomain(merged)
  }

  removeDomain(domainId: string): void {
    for (const name of this.store.getAeDomain(domainId)?.secretNames ?? []) {
      this.store.removeAeDomainSecret(domainId, name)
    }
    this.store.removeAeDomain(domainId)
  }

  reposInGroup(groupId: string): Repo[] {
    return this.store.getRepos().filter((repo) => repo.projectGroupId === groupId)
  }

  detectRoles(groupId: string): AeDomainRepo[] {
    return this.reposInGroup(groupId).map((repo) => ({
      repoId: repo.id,
      role: detectAeRepoRole(repo.path)
    }))
  }

  roleForRepo(repoId: string): { domain: AeDomainConfig; role: AeRepoRole } | null {
    for (const domain of this.listDomains()) {
      const entry = domain.repos.find((repo) => repo.repoId === repoId)
      if (entry) {
        return { domain, role: entry.role }
      }
    }
    const repo = this.store.getRepo(repoId)
    const domain = repo?.projectGroupId ? this.store.getAeDomain(repo.projectGroupId) : null
    return domain ? { domain, role: 'other' } : null
  }

  setSecret(domainId: string, name: string, value: string): void {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error('Secret names are upper-case environment variable names, like OMNI_API_KEY')
    }
    const secrets = getSecretStore()
    if (!secrets.isEncryptionAvailable()) {
      throw new Error('This host cannot encrypt secrets at rest, so Pod will not store one.')
    }
    const domain = this.store.getAeDomain(domainId)
    if (!domain) {
      throw new Error(`Domain "${domainId}" not found`)
    }
    this.store.setAeDomainSecret(domainId, name, secrets.encryptString(value).toString('base64'))
    if (!domain.secretNames.includes(name)) {
      this.store.saveAeDomain({ ...domain, secretNames: [...domain.secretNames, name] })
    }
  }

  removeSecret(domainId: string, name: string): void {
    this.store.removeAeDomainSecret(domainId, name)
    const domain = this.store.getAeDomain(domainId)
    if (domain) {
      this.store.saveAeDomain({
        ...domain,
        secretNames: domain.secretNames.filter((entry) => entry !== name)
      })
    }
  }

  /** Decrypted secrets for one domain; values never leave the main process except into an agent's env. */
  readSecrets(domainId: string): Record<string, string> {
    const domain = this.store.getAeDomain(domainId)
    if (!domain) {
      return {}
    }
    const secrets = getSecretStore()
    const values: Record<string, string> = {}
    for (const name of domain.secretNames) {
      const cipher = this.store.getAeDomainSecretCipher(domainId, name)
      if (!cipher) {
        continue
      }
      try {
        values[name] = secrets.decryptString(Buffer.from(cipher, 'base64'))
      } catch {
        // Why: a secret sealed on another machine is unreadable here; leave it out rather than fail the launch.
      }
    }
    return values
  }

  listInitiatives(domainId?: string): AeInitiative[] {
    return this.store.getAeInitiatives(domainId).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveInitiative(input: AeInitiativeSaveInput): AeInitiative {
    const domain = this.store.getAeDomain(input.domainId)
    if (!domain) {
      throw new Error(`Domain "${input.domainId}" not found`)
    }
    const existing = input.id
      ? this.store.getAeInitiatives().find((entry) => entry.id === input.id)
      : undefined
    const slug = input.slug ?? existing?.slug ?? aeInitiativeSlug(input.title)
    const group = this.store.getProjectGroups().find((entry) => entry.id === domain.id)
    const folderPath =
      input.folderPath ?? existing?.folderPath ?? `${group?.parentPath ?? ''}/initiatives/${slug}`
    const now = Date.now()
    return this.store.saveAeInitiative({
      id: existing?.id ?? input.id ?? randomUUID(),
      domainId: input.domainId,
      title: input.title,
      slug,
      folderPath,
      repoIds: input.repoIds ?? existing?.repoIds ?? domain.repos.map((repo) => repo.repoId),
      status: input.status ?? existing?.status ?? 'planning',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.stakeholderTeam !== undefined
        ? { stakeholderTeam: input.stakeholderTeam || undefined }
        : existing?.stakeholderTeam
          ? { stakeholderTeam: existing.stakeholderTeam }
          : {}),
      ...((input.coordinatorWorkspaceKey ?? existing?.coordinatorWorkspaceKey)
        ? {
            coordinatorWorkspaceKey:
              input.coordinatorWorkspaceKey ?? existing?.coordinatorWorkspaceKey
          }
        : {}),
      ...((input.runId ?? existing?.runId) ? { runId: input.runId ?? existing?.runId } : {})
    })
  }

  removeInitiative(initiativeId: string): void {
    this.store.removeAeInitiative(initiativeId)
  }

  get runtimeService(): OrcaRuntimeService {
    return this.runtime
  }
}

let installed: AeDomainService | null = null

export function installAeDomainService(store: Store, runtime: OrcaRuntimeService): AeDomainService {
  installed = new AeDomainService(store, runtime)
  return installed
}

export function getAeDomainService(): AeDomainService {
  if (!installed) {
    throw new Error('Pod domain service is not installed yet')
  }
  return installed
}

export function getAeDomainServiceIfInstalled(): AeDomainService | null {
  return installed
}
