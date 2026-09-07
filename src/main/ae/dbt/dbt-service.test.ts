import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AeDomainService } from '../domain-service'
import { AeDbtService, DbtRunError } from './dbt-service'
import { FIXTURE_MANIFEST } from './dbt-manifest.test'

/**
 * A shell script stands in for dbt: it records its arguments and a few env values,
 * then answers each subcommand the way dbt Core does on stdout.
 */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
printf 'cwd=%s\\nPERSONAL_DATASET=%s\\nOMNI_API_KEY=%s\\nFROM_SETTINGS=%s\\n' "$PWD" "$PERSONAL_DATASET" "$OMNI_API_KEY" "$FROM_SETTINGS" > "$STUB_ENV"
case " $* " in
  *" bad "*) echo '{"info": {"level": "error", "msg": "Compilation Error in model bad"}}'; exit 2 ;;
  *" parse "*) mkdir -p target; cp "$STUB_MANIFEST" target/manifest.json; exit 0 ;;
  *" show "*) echo "12:00:00  Running with dbt=1.9.0"; echo '{"show": [{"id": 1, "name": "a"}, {"id": 2, "name": null}]}'; exit 0 ;;
  *" compile "*) mkdir -p target; cp "$STUB_MANIFEST" target/manifest.json; echo '{"data": {"node_name": "fct_orders", "compiled": "select 1 as compiled"}, "info": {"name": "CompiledNode", "level": "info", "msg": "x"}}'; exit 0 ;;
esac
exit 1
`

let root: string
let repo: string
let project: string
let stubLog: string
let stubEnv: string

function fakeStore(settings: Record<string, unknown>): Store {
  return { getSettings: () => settings } as unknown as Store
}

function fakeRuntime(worktreePath: string | null): OrcaRuntimeService {
  return {
    showManagedWorktree: async (selector: string) => {
      if (worktreePath && selector === `path:${worktreePath}`) {
        return { id: 'repo-1::main', repoId: 'repo-1', path: worktreePath }
      }
      throw new Error('selector_not_found')
    }
  } as unknown as OrcaRuntimeService
}

function fakeDomains(): AeDomainService {
  return {
    roleForRepo: (repoId: string) =>
      repoId === 'repo-1'
        ? {
            role: 'dbt',
            domain: {
              id: 'mex',
              env: { PERSONAL_DATASET: 'from_domain' },
              dbt: { target: 'dev', profilesDir: join(repo, 'local_profiles') }
            }
          }
        : null,
    readSecrets: () => ({ OMNI_API_KEY: 'shh' })
  } as unknown as AeDomainService
}

function makeService(
  options: { worktree?: boolean; domains?: boolean; settings?: Record<string, unknown> } = {}
): AeDbtService {
  const binary = join(root, 'dbt')
  return new AeDbtService({
    store: fakeStore({
      toolCmdOverrides: { dbt: binary },
      aeDbt: { showLimit: 50, env: { FROM_SETTINGS: 'yes' } },
      ...options.settings
    }),
    runtime: fakeRuntime(options.worktree === false ? null : repo),
    domains: options.domains === false ? null : fakeDomains(),
    env: {
      PATH: process.env.PATH,
      STUB_LOG: stubLog,
      STUB_ENV: stubEnv,
      STUB_MANIFEST: join(root, 'manifest.json')
    }
  })
}

beforeEach(() => {
  // Why realpath: macOS puts tmpdir behind a symlink and the child's $PWD is the real path.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-dbt-service-')))
  repo = join(root, 'repo')
  project = join(repo, 'dbt')
  mkdirSync(join(project, 'models', 'marts'), { recursive: true })
  mkdirSync(join(repo, '.git'))
  writeFileSync(join(project, 'dbt_project.yml'), 'name: demo\nprofile: demo\n')
  writeFileSync(join(repo, '.env'), 'PERSONAL_DATASET=from_file\n')
  writeFileSync(join(project, 'models', 'marts', 'fct_orders.sql'), 'select 1')
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(FIXTURE_MANIFEST))
  writeFileSync(join(root, 'dbt'), STUB)
  chmodSync(join(root, 'dbt'), 0o755)
  stubLog = join(root, 'stub.log')
  stubEnv = join(root, 'stub.env')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('AeDbtService', () => {
  it('resolves the project, repo, domain and manifest from a model path', async () => {
    const summary = await makeService().project({
      path: join(project, 'models', 'marts', 'fct_orders.sql')
    })
    expect(summary.project.projectDir).toBe(project)
    expect(summary.repoRoot).toBe(repo)
    expect(summary.worktree?.repoId).toBe('repo-1')
    expect(summary.domainId).toBe('mex')
    expect(summary.target).toBe('dev')
    expect(summary.profiles).toEqual({ dir: join(repo, 'local_profiles'), source: 'settings' })
    expect(summary.envFiles).toEqual([join(repo, '.env')])
    expect(summary.manifest.exists).toBe(false)
    expect(JSON.stringify(summary)).not.toContain('shh')
  })

  it('runs show from the project directory with the merged environment', async () => {
    const result = await makeService().show({ path: project, model: 'fct_orders', limit: 5000 })
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toEqual([
      [1, 'a'],
      [2, null]
    ])
    expect(result.limit).toBe(500)
    expect(readFileSync(stubLog, 'utf8').trim()).toBe(
      `--quiet show --select fct_orders --limit 500 --output json --target dev --profiles-dir ${join(repo, 'local_profiles')}`
    )
    // Why these three: env file < domain env, secrets reach the child, settings env is applied.
    expect(readFileSync(stubEnv, 'utf8')).toBe(
      `cwd=${project}\nPERSONAL_DATASET=from_domain\nOMNI_API_KEY=shh\nFROM_SETTINGS=yes\n`
    )
  })

  it('falls back to the env file and profile default outside a domain', async () => {
    await makeService({ worktree: false, domains: false }).show({ path: project, sql: 'select 1' })
    expect(readFileSync(stubLog, 'utf8').trim()).toBe(
      '--quiet show --inline select 1 --limit 50 --output json'
    )
    expect(readFileSync(stubEnv, 'utf8')).toContain('PERSONAL_DATASET=from_file')
  })

  it('parses on demand for manifest questions and answers from it', async () => {
    const service = makeService()
    const list = await service.listModels({ path: project })
    expect(list.models.map((model) => model.name)).toEqual(['fct_orders', 'stg_orders'])
    expect(readFileSync(stubLog, 'utf8').trim().split('\n')).toHaveLength(1)
    const info = await service.modelInfo({ path: project, model: 'stg_orders' })
    expect(info.columns).toEqual([{ name: 'id', description: 'pk', dataType: 'INT64' }])
    expect(info.referencedBy.map((entry) => entry.name)).toEqual(['fct_orders'])
    const lineage = await service.lineage({ path: project, model: 'fct_orders', depth: 3 })
    expect(lineage.upstream.map((entry) => entry.name)).toEqual(['stg_orders', 'orders'])
    // Why: the manifest already exists, so no second parse ran.
    expect(readFileSync(stubLog, 'utf8').trim().split('\n')).toHaveLength(1)
    await service.listModels({ path: project, refresh: true })
    expect(readFileSync(stubLog, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('compiles through JSON logs and names the compiled file', async () => {
    const result = await makeService().compile({ path: project, model: 'fct_orders' })
    expect(result.sql).toBe('select 1 as compiled')
    expect(result.file).toBe(
      join(project, 'target', 'compiled', 'demo', 'models', 'marts', 'fct_orders.sql')
    )
    expect(readFileSync(stubLog, 'utf8').trim()).toContain(
      '--log-format json compile --select fct_orders'
    )
  })

  it("surfaces dbt's own error message and refuses to run without a binary", async () => {
    await expect(makeService().compile({ path: project, model: 'bad' })).rejects.toThrow(
      'Compilation Error in model bad'
    )
    await expect(makeService().show({ path: project })).rejects.toThrow(
      'Pass a model name or inline SQL.'
    )
    await expect(makeService().project({ path: root })).rejects.toThrow('No dbt_project.yml')
    const missing = makeService({ settings: { toolCmdOverrides: { dbt: '' } } })
    await expect(
      makeService({
        settings: { toolCmdOverrides: {} }
      }).show({ path: project, sql: 'select 1' })
    ).rejects.toBeInstanceOf(DbtRunError)
    void missing
  })
})
