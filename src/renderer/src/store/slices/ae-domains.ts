import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { AeDomainConfig, AeDomainRepo, AeInitiative } from '../../../../shared/ae/domain-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { createAeDbtResultsSlice, type AeDbtResultsSlice } from './ae-dbt-results'

/** Which Pod dialog the project group menu opened; dialogs mount outside the Radix menu, which unmounts on select. */
export type AeDialogState = {
  kind: 'domain-settings' | 'new-initiative'
  groupId: string
  label: string
}

/** Pod: domains and initiatives, fetched lazily and refreshed on the main process's `ae:changed`. */
export type AeDomainsSlice = AeDbtResultsSlice & {
  aeDomains: Record<string, AeDomainConfig>
  aeInitiatives: AeInitiative[]
  aeLoaded: boolean
  aeDialog: AeDialogState | null
  openAeDialog: (dialog: AeDialogState) => void
  closeAeDialog: () => void
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
  launchAeInitiative: (args: {
    domainId: string
    title: string
    stakeholderTeam?: string
    agent?: TuiAgent
    repoIds?: string[]
  }) => Promise<AeInitiative>
  openAeDomainMainAgent: (
    domainId: string,
    agent?: TuiAgent
  ) => Promise<{ workspaceKey: string; reused: boolean }>
}

function aeApi(): Window['api']['ae'] | null {
  return typeof window !== 'undefined' && window.api?.ae ? window.api.ae : null
}

export const createAeDomainsSlice: StateCreator<AppState, [], [], AeDomainsSlice> = (
  set,
  get,
  api
) => {
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
    ...createAeDbtResultsSlice(set, get, api),
    aeDomains: {},
    aeInitiatives: [],
    aeLoaded: false,
    aeDialog: null,
    openAeDialog: (dialog) => set({ aeDialog: dialog }),
    closeAeDialog: () => set({ aeDialog: null }),
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
    },
    launchAeInitiative: async (args) => {
      const api = aeApi()
      if (!api) {
        throw new Error('Pod domain API unavailable')
      }
      const initiative = await api.initiatives.launch(args)
      const others = get().aeInitiatives.filter((entry) => entry.id !== initiative.id)
      set({ aeInitiatives: [initiative, ...others] })
      return initiative
    },
    openAeDomainMainAgent: async (domainId, agent) => {
      const api = aeApi()
      if (!api) {
        throw new Error('Pod domain API unavailable')
      }
      const result = await api.domains.openMainAgent({ domainId, agent })
      await refresh()
      return result
    }
  }
}
