import type { AeDomainConfig, AeDomainRepo, AeInitiative } from '../../shared/ae/domain-types'

/** Pod: domains (folders of repos with roles) and initiatives (cross-repo runs). */
export type AeApi = {
  domains: {
    list: () => Promise<AeDomainConfig[]>
    save: (input: Partial<AeDomainConfig> & { id: string }) => Promise<AeDomainConfig>
    remove: (args: { domainId: string }) => Promise<void>
    detectRoles: (args: { groupId: string }) => Promise<AeDomainRepo[]>
    setSecret: (args: { domainId: string; name: string; value: string }) => Promise<void>
    removeSecret: (args: { domainId: string; name: string }) => Promise<void>
  }
  initiatives: {
    list: (args?: { domainId?: string }) => Promise<AeInitiative[]>
    save: (
      input: Partial<AeInitiative> & { domainId: string; title: string }
    ) => Promise<AeInitiative>
    remove: (args: { initiativeId: string }) => Promise<void>
  }
  onChanged: (callback: () => void) => () => void
}
