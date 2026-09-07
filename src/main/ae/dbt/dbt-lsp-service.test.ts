import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DbtLspEvent } from '../../../shared/ae/dbt-lsp-types'
import { DEFAULT_AE_DBT_SETTINGS } from '../../../shared/ae/dbt-settings-types'
import type { DbtContext } from './dbt-context'
import { DbtLspService } from './dbt-lsp-service'
import type { AeDbtService } from './dbt-service'

const FAKE_SERVER = join(__dirname, '__fixtures__', 'fake-dbt-language-server.mjs')

let root: string
let project: string
let wrapper: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-lsp-service-'))
  project = join(root, 'repo', 'dbt')
  mkdirSync(join(project, 'models'), { recursive: true })
  writeFileSync(join(project, 'dbt_project.yml'), 'name: demo\n')
  writeFileSync(join(project, 'models', 'orders.sql'), 'select 1')
  // Why a wrapper: the service runs a binary; a shell script that execs node keeps the fake in JS.
  wrapper = join(root, 'dbt-language-server')
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SERVER}" "$@"\n`)
  chmodSync(wrapper, 0o755)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeDbt(overrides: Partial<DbtContext> = {}): AeDbtService {
  return {
    resolve: async (request: { path: string }) => {
      if (!request.path.startsWith(project)) {
        throw new Error('No dbt_project.yml')
      }
      const context: DbtContext = {
        project: {
          projectDir: project,
          projectFile: join(project, 'dbt_project.yml'),
          name: 'demo',
          modelPaths: ['models'],
          macroPaths: [],
          targetPath: 'target'
        },
        repoRoot: join(root, 'repo'),
        worktree: null,
        domainId: null,
        binary: null,
        profiles: { source: 'dbt' },
        envFiles: [],
        env: { PATH: '/nonexistent' },
        settings: { ...DEFAULT_AE_DBT_SETTINGS },
        toolOverrides: { dbtLsp: wrapper },
        ...overrides
      }
      return context
    }
  } as unknown as AeDbtService
}

function service(dbt: AeDbtService, events: DbtLspEvent[]): DbtLspService {
  return new DbtLspService({
    dbt,
    userData: () => join(root, 'userData'),
    fetch: async () => new Response('', { status: 500 }),
    emit: (event) => events.push(event),
    idleStopMs: 50
  })
}

describe('DbtLspService', () => {
  it('starts one server per project on open, answers requests and stops when idle', async () => {
    const events: DbtLspEvent[] = []
    const lsp = service(fakeDbt(), events)
    const path = join(project, 'models', 'orders.sql')
    const status = await lsp.open({ path, text: 'select 1', version: 1 })
    expect(status.state).toBe('running')
    expect(status.binary).toBe(wrapper)
    expect(status.binarySource).toBe('settings')
    expect(status.serverVersion).toBe('v9.9.9')

    const hover = await lsp.hover({ path, position: { line: 0, character: 1 } })
    expect(hover?.contents).toBe('hover at 0:1')
    const completion = await lsp.completion({ path, position: { line: 0, character: 0 } })
    expect(completion.map((item) => item.label)).toEqual(['orders', 'stg_orders'])
    await lsp.change({ path, text: 'select 2', version: 2 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const diagnostics = events.filter((event) => event.kind === 'diagnostics')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].kind === 'diagnostics' && diagnostics[0].event.path).toBe(path)

    await lsp.close({ path })
    // Why 900 ms: the idle timer is 50 ms here and a polite stop waits 200 ms after `exit`.
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect((await lsp.status({ path })).state).toBe('stopped')
    await lsp.stopAll()
  })

  it('answers unavailable for a file outside any project and never spawns', async () => {
    const events: DbtLspEvent[] = []
    const lsp = service(fakeDbt(), events)
    const status = await lsp.open({ path: join(root, 'elsewhere.sql'), text: '', version: 1 })
    expect(status.state).toBe('unavailable')
    expect(
      await lsp.completion({
        path: join(root, 'elsewhere.sql'),
        position: { line: 0, character: 0 }
      })
    ).toEqual([])
    expect(events).toEqual([])
  })

  it('reports disabled when the setting is off', async () => {
    const lsp = service(
      fakeDbt({ settings: { ...DEFAULT_AE_DBT_SETTINGS, lspEnabled: false } }),
      []
    )
    const status = await lsp.open({
      path: join(project, 'models', 'orders.sql'),
      text: '',
      version: 1
    })
    expect(status.state).toBe('disabled')
  })

  it('reports an error with the download reason when no binary can be found', async () => {
    const events: DbtLspEvent[] = []
    const lsp = new DbtLspService({
      dbt: fakeDbt({ toolOverrides: {} }),
      userData: () => join(root, 'userData'),
      fetch: async () => new Response('', { status: 404 }),
      emit: (event) => events.push(event),
      platform: 'darwin',
      arch: 'x64'
    })
    const status = await lsp.open({
      path: join(project, 'models', 'orders.sql'),
      text: '',
      version: 1
    })
    expect(status.state).toBe('error')
    expect(status.message).toContain('404')
    expect(events.some((event) => event.kind === 'status' && event.event.downloading)).toBe(true)
  })

  it('restart brings a fresh server for the open documents', async () => {
    const lsp = service(fakeDbt(), [])
    const path = join(project, 'models', 'orders.sql')
    await lsp.open({ path, text: 'select 1', version: 1 })
    const status = await lsp.restart({ path })
    expect(status.state).toBe('running')
    expect((await lsp.definition({ path, position: { line: 0, character: 0 } }))[0]?.uri).toContain(
      'stg_orders.sql'
    )
    await lsp.stopAll()
  })
})
