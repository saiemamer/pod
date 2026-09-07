import type { AeDomainConfig, AeInitiative } from '../../../shared/ae/domain-types'
import { normalizeAeDomains, normalizeAeInitiatives } from '../../../shared/ae/domain-types'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type AeDomainRuntime = Pick<StoreRuntimeState, 'state'>

const aeDomainPersistenceContext = Symbol('AeDomainPersistence')
type AeDomainPersistenceContext = {
  runtime: AeDomainRuntime
  scheduling: WriteSchedulingOperations
}

/**
 * Pod: domains (one per project group) and initiatives live as two optional top-level
 * keys of the persisted state; unknown keys round-trip untouched, so upstream never sees them.
 * Reads normalize because the bytes on disk may come from a newer or older Pod.
 */
export class AeDomainPersistence {
  readonly [aeDomainPersistenceContext]: AeDomainPersistenceContext

  constructor(runtime: AeDomainRuntime, scheduling: WriteSchedulingOperations) {
    this[aeDomainPersistenceContext] = { runtime, scheduling }
  }

  getAeDomains(): Record<string, AeDomainConfig> {
    return normalizeAeDomains(this[aeDomainPersistenceContext].runtime.state.aeDomains)
  }

  getAeDomain(domainId: string): AeDomainConfig | null {
    return this.getAeDomains()[domainId] ?? null
  }

  saveAeDomain(domain: AeDomainConfig): AeDomainConfig {
    const saved: AeDomainConfig = { ...domain, updatedAt: Date.now() }
    this[aeDomainPersistenceContext].runtime.state.aeDomains = {
      ...this.getAeDomains(),
      [saved.id]: saved
    }
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
    return saved
  }

  removeAeDomain(domainId: string): void {
    const { [domainId]: _removed, ...rest } = this.getAeDomains()
    this[aeDomainPersistenceContext].runtime.state.aeDomains = rest
    this[aeDomainPersistenceContext].runtime.state.aeInitiatives = this.getAeInitiatives().filter(
      (initiative) => initiative.domainId !== domainId
    )
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
  }

  getAeInitiatives(domainId?: string): AeInitiative[] {
    const all = normalizeAeInitiatives(this[aeDomainPersistenceContext].runtime.state.aeInitiatives)
    return domainId ? all.filter((initiative) => initiative.domainId === domainId) : all
  }

  saveAeInitiative(initiative: AeInitiative): AeInitiative {
    const saved: AeInitiative = { ...initiative, updatedAt: Date.now() }
    const existing = this.getAeInitiatives()
    const index = existing.findIndex((entry) => entry.id === saved.id)
    this[aeDomainPersistenceContext].runtime.state.aeInitiatives =
      index === -1
        ? [...existing, saved]
        : existing.map((entry, i) => (i === index ? saved : entry))
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
    return saved
  }

  /** Ciphertext (base64 of safeStorage output) keyed `<domainId>:<NAME>`; decrypted only at agent launch. */
  getAeDomainSecretCipher(domainId: string, name: string): string | null {
    const secrets = this[aeDomainPersistenceContext].runtime.state.aeDomainSecrets
    const cipher = secrets?.[`${domainId}:${name}`]
    return typeof cipher === 'string' && cipher.length > 0 ? cipher : null
  }

  setAeDomainSecret(domainId: string, name: string, cipher: string): void {
    this[aeDomainPersistenceContext].runtime.state.aeDomainSecrets = {
      ...this[aeDomainPersistenceContext].runtime.state.aeDomainSecrets,
      [`${domainId}:${name}`]: cipher
    }
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
  }

  removeAeDomainSecret(domainId: string, name: string): void {
    const { [`${domainId}:${name}`]: _removed, ...rest } =
      this[aeDomainPersistenceContext].runtime.state.aeDomainSecrets ?? {}
    this[aeDomainPersistenceContext].runtime.state.aeDomainSecrets = rest
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
  }

  removeAeInitiative(initiativeId: string): void {
    this[aeDomainPersistenceContext].runtime.state.aeInitiatives = this.getAeInitiatives().filter(
      (entry) => entry.id !== initiativeId
    )
    scheduleSave(this[aeDomainPersistenceContext].scheduling)
  }
}

export function installAeDomainPersistenceContext(
  target: object,
  source: AeDomainPersistence
): void {
  Object.defineProperty(target, aeDomainPersistenceContext, {
    value: source[aeDomainPersistenceContext]
  })
}
