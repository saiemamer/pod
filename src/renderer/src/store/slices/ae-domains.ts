import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { AeDomainConfig, AeDomainRepo, AeInitiative } from '../../../../shared/ae/domain-types'

/** Pod: domains and initiatives, fetched lazily and refreshed on the main process's `ae:changed`. */
export type AeDomainsSlice = {
  aeDomains: Record<string, AeDomainConfig>
  aeInitiatives: AeInitiative[]
  aeLoaded: boolean
  fetchAeDomains: () => Promise<void>
  saveAeDomain: (input: Partial<AeDomainConfig> & { id: string }) => Promise<AeDomainConfig>
  removeAeDomain: (domainId: string) => Promise<void>
  detectAeRepoRoles: (groupId: string) => Promise<AeDomainRepo[]>
  setAeDomainSecret: (domainId: string, name: string, value: string) => Promise<void>
  removeAeDomainSecret: (domainId: string, name: string) => Promise<void>
  saveAeInitiative: (
    input: Partial<AeInitiative> & { domainId: string; title: string }
  ) => Promise<AeInitiative>
  removeAeInitiative: (initiativeId: string) => Promise<void>
}

function aeApi(): Window['api']['ae'] | null {
  return typeof window !== 'undefined' && window.api?.ae ? window.api.ae : null
}

export const createAeDomainsSlice: StateCreator<AppState, [], [], AeDomainsSlice> = (set, get) => {
  let subscribed = false
  const refresh = async (): Promise<void> => {
    const api = aeApi()
    if (!api) {
      return
    }
    const [domains, initiatives] = await Promise.all([api.domains.list(), api.initiatives.list()])
    set({
      aeDomains: Object.fromEntries(domains.map((domain) => [domain.id, domain])),
      aeInitiatives: initiatives,
      aeLoaded: true
    })
  }
  return {
    aeDomains: {},
    aeInitiatives: [],
    aeLoaded: false,
    fetchAeDomains: async () => {
      const api = aeApi()
      if (api && !subscribed) {
        subscribed = true
        api.onChanged(() => void refresh())
      }
      await refresh()
    },
    saveAeDomain: async (input) => {
      const api = aeApi()
      if (!api) {
        throw new Error('Pod domain API unavailable')
      }
      const saved = await api.domains.save(input)
      set({ aeDomains: { ...get().aeDomains, [saved.id]: saved } })
      return saved
    },
    removeAeDomain: async (domainId) => {
      await aeApi()?.domains.remove({ domainId })
      const { [domainId]: _removed, ...rest } = get().aeDomains
      set({
        aeDomains: rest,
        aeInitiatives: get().aeInitiatives.filter((initiative) => initiative.domainId !== domainId)
      })
    },
    detectAeRepoRoles: async (groupId) => (await aeApi()?.domains.detectRoles({ groupId })) ?? [],
    setAeDomainSecret: async (domainId, name, value) => {
      await aeApi()?.domains.setSecret({ domainId, name, value })
      await refresh()
    },
    removeAeDomainSecret: async (domainId, name) => {
      await aeApi()?.domains.removeSecret({ domainId, name })
      await refresh()
    },
    saveAeInitiative: async (input) => {
      const api = aeApi()
      if (!api) {
        throw new Error('Pod domain API unavailable')
      }
      const saved = await api.initiatives.save(input)
      const others = get().aeInitiatives.filter((initiative) => initiative.id !== saved.id)
      set({ aeInitiatives: [saved, ...others] })
      return saved
    },
    removeAeInitiative: async (initiativeId) => {
      await aeApi()?.initiatives.remove({ initiativeId })
      set({
        aeInitiatives: get().aeInitiatives.filter((initiative) => initiative.id !== initiativeId)
      })
    }
  }
}
