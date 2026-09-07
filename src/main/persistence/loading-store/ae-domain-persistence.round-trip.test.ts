import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'pod-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { Store } = await import('./store')

const stores: InstanceType<typeof Store>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.flush()
  }
})

function openStore(dataFile: string): InstanceType<typeof Store> {
  const store = new Store({ dataFile })
  stores.push(store)
  return store
}

describe('AeDomainPersistence', () => {
  it('round-trips domains and initiatives through the real store file', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pod-domains-')))
    const dataFile = join(dir, 'state.json')
    const first = openStore(dataFile)
    expect(first.getAeDomains()).toEqual({})

    const saved = first.saveAeDomain({
      id: 'group-1',
      name: 'MEX',
      repos: [
        { repoId: 'repo-dbt', role: 'dbt' },
        { repoId: 'repo-omni', role: 'omni' }
      ],
      env: { DBT_TARGET: 'dev' },
      secretNames: ['OMNI_API_KEY'],
      stakeholderTeams: ['Channels', 'Support Optimisation'],
      createdAt: 1,
      updatedAt: 1
    })
    first.saveAeInitiative({
      id: 'init-1',
      domainId: 'group-1',
      title: 'OpenCX migration',
      slug: 'opencx-migration',
      stakeholderTeam: 'Support Optimisation',
      folderPath: '/teams/mex/initiatives/opencx-migration',
      repoIds: ['repo-dbt', 'repo-omni'],
      status: 'planning',
      createdAt: 1,
      updatedAt: 1
    })
    first.flush()

    const second = openStore(dataFile)
    expect(second.getAeDomain('group-1')).toEqual(saved)
    expect(second.getAeInitiatives('group-1').map((initiative) => initiative.title)).toEqual([
      'OpenCX migration'
    ])
    expect(second.getAeInitiatives('other')).toEqual([])

    second.removeAeDomain('group-1')
    second.flush()
    const third = openStore(dataFile)
    expect(third.getAeDomains()).toEqual({})
    expect(third.getAeInitiatives()).toEqual([])
  })
})
