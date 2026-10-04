import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../persistence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { DbtPrepareState } from '../../../shared/ae/dbt-readiness-types'
import { DbtCopyPreparer } from './dbt-copy-prepare'
import { AeDbtService } from './dbt-service'

const SECRET = 'glpat-s3cr3t-value-1234'

/**
 * Stand-in for dbt Core. `deps` installs one package, or fails the way a git host
 * refuses a private package (echoing the URL with the token filled in, as git does);
 * `parse` refuses to run until packages exist, like dbt with "0 installed".
 */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case " $* " in
  *" deps "*)
    if [ -n "$STUB_DEPS_DENIED" ]; then
      echo "fatal: Authentication failed for 'https://oauth2:$GITLAB_TOKEN@gitlab.example.com/data/macros.git/'"
      echo "remote: HTTP Basic: Access denied."
      exit 1
    fi
    mkdir -p dbt_packages/dbt_utils; echo "$GITLAB_TOKEN" > "$STUB_SEEN_TOKEN"; exit 0 ;;
  *" parse "*)
    if [ ! -d dbt_packages/dbt_utils ]; then
      echo "1 package(s) specified in packages.yml, but only 0 package(s) installed"; exit 1
    fi
    mkdir -p target; echo '{"metadata": {"dbt_version": "1.9.0"}, "nodes": {}, "sources": {}}' > target/manifest.json
    echo "$GITLAB_TOKEN" > "$STUB_SEEN_TOKEN"; exit 0 ;;
esac
exit 1
`

const PACKAGES = `packages:
  - package: dbt-labs/dbt_utils
    version: 1.3.0
  - git: "https://oauth2:{{ env_var('GITLAB_TOKEN', 'placeholder') }}@gitlab.example.com/data/macros.git"
    revision: main
`

let root: string
let main: string
let copy: string
let stubLog: string
let seenToken: string

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function makePreparer(
  emitted: DbtPrepareState[],
  restarted: string[],
  extraEnv: Record<string, string> = {}
): DbtCopyPreparer {
  const dbt = new AeDbtService({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolveDbtContext reads only getSettings().
    store: {
      getSettings: () => ({ toolCmdOverrides: { dbt: join(root, 'dbt') } })
    } as unknown as Store,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the context reads only showManagedWorktree, which answers "not managed".
    runtime: {
      showManagedWorktree: async () => {
        throw new Error('selector_not_found')
      }
    } as unknown as OrcaRuntimeService,
    domains: null,
    env: { PATH: process.env.PATH, STUB_LOG: stubLog, STUB_SEEN_TOKEN: seenToken, ...extraEnv }
  })
  return new DbtCopyPreparer({
    dbt,
    restartLsp: async (projectDir) => restarted.push(projectDir),
    emit: (state) => emitted.push(state)
  })
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-dbt-copy-')))
  main = join(root, 'repo')
  copy = join(root, 'copy')
  stubLog = join(root, 'stub.log')
  seenToken = join(root, 'seen-token')
  writeFileSync(join(root, 'dbt'), STUB)
  chmodSync(join(root, 'dbt'), 0o755)
  mkdirSync(join(main, 'transform', 'models'), { recursive: true })
  writeFileSync(join(main, 'transform', 'dbt_project.yml'), 'name: demo\nprofile: demo\n')
  writeFileSync(join(main, 'transform', 'packages.yml'), PACKAGES)
  writeFileSync(join(main, 'transform', 'models', 'orders.sql'), 'select 1\n')
  writeFileSync(join(main, '.gitignore'), '.env\ndbt_packages/\ntarget/\n')
  git(main, 'init', '-q')
  git(main, 'add', '-A')
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  // The main copy as a person left it: an untracked .env with the token, packages installed.
  writeFileSync(join(main, '.env'), `GITLAB_TOKEN=${SECRET}\n`)
  mkdirSync(join(main, 'transform', 'dbt_packages', 'dbt_utils'), { recursive: true })
  mkdirSync(join(main, 'transform', 'dbt_packages', 'macros'), { recursive: true })
  writeFileSync(join(main, 'transform', 'dbt_packages', 'dbt_utils', 'marker'), 'main')
  git(main, 'worktree', 'add', '-q', '-b', 'feature', copy)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function stubCalls(): string[] {
  return existsSync(stubLog) ? readFileSync(stubLog, 'utf8').trim().split('\n') : []
}

describe('DbtCopyPreparer', () => {
  it('reuses the main copy packages without dbt deps, parses, and restarts the language server', async () => {
    const emitted: DbtPrepareState[] = []
    const restarted: string[] = []
    const preparer = makePreparer(emitted, restarted)
    const project = join(copy, 'transform')

    const before = await preparer.readiness({ path: join(project, 'models', 'orders.sql') })
    expect(before.readiness).toMatchObject({
      packagesListed: 2,
      packagesInstalled: false,
      manifest: false,
      ready: false
    })

    const done = await preparer.prepareNewCopy(copy)

    expect(done?.state).toBe('done')
    expect(done?.readiness.ready).toBe(true)
    expect(readFileSync(join(project, 'dbt_packages', 'dbt_utils', 'marker'), 'utf8')).toBe('main')
    expect(stubCalls().some((line) => line.includes('deps'))).toBe(false)
    expect(stubCalls().some((line) => line.includes('parse'))).toBe(true)
    expect(emitted.map((state) => state.step).filter(Boolean)).toEqual(['packages-reuse', 'parse'])
    expect(restarted).toEqual([project])
    // The runner in the copy saw the main copy's token.
    expect(readFileSync(seenToken, 'utf8').trim()).toBe(SECRET)
    expect((await preparer.readiness({ path: project })).state).toBe('done')
  })

  it('runs dbt deps when the copy lists different packages', async () => {
    writeFileSync(join(copy, 'transform', 'packages.yml'), `${PACKAGES}  - package: x/y\n`)
    const emitted: DbtPrepareState[] = []
    const preparer = makePreparer(emitted, [])

    const done = await preparer.prepare({ path: join(copy, 'transform') })

    expect(done.state).toBe('done')
    const calls = stubCalls()
    expect(calls.findIndex((line) => line.includes('deps'))).toBeGreaterThanOrEqual(0)
    expect(calls.findIndex((line) => line.includes('deps'))).toBeLessThan(
      calls.findIndex((line) => line.includes('parse'))
    )
    expect(existsSync(join(copy, 'transform', 'dbt_packages', 'dbt_utils', 'marker'))).toBe(false)
  })

  it('names the token variable of a refused private package and never shows its value', async () => {
    rmSync(join(main, 'transform', 'dbt_packages'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const emitted: DbtPrepareState[] = []
    const preparer = makePreparer(emitted, [], { STUB_DEPS_DENIED: '1' })

    const failed = await preparer.prepare({ path: join(copy, 'transform') })

    expect(failed.state).toBe('failed')
    expect(failed.failure?.kind).toBe('private-package')
    expect(failed.failure?.tokenVariable).toBe('GITLAB_TOKEN')
    expect(failed.failure?.details).toContain('Access denied')
    const seen = JSON.stringify([
      failed,
      emitted,
      await preparer.readiness({ path: join(copy, 'transform') }),
      warn.mock.calls,
      log.mock.calls
    ])
    expect(seen).not.toContain(SECRET)
    expect(stubCalls().some((line) => line.includes('parse'))).toBe(false)
  })

  it('leaves a main checkout alone when a worktree is created there', async () => {
    const preparer = makePreparer([], [])
    expect(await preparer.prepareNewCopy(main)).toBeNull()
    expect(stubCalls()).toEqual([])
  })
})
