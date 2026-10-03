// Phase 4 smoke: `orca orchestration worker-start` from a coordinator in a folder workspace,
// the way a Pod initiative's main agent sits. --worktree new-child --repo must create the
// worker's worktree in that repo as a child of the folder workspace (it failed with a bare
// selector_not_found before the fix), and leaving out --repo must say why. Needs `pnpm dev`
// with REMOTE_DEBUGGING_PORT=9333, `pnpm build:cli`, and the pod-smoke group from
// ui-smoke.mjs. Claude's command is pointed at /bin/cat for the run, so no agent starts and
// no usage is spent; worker readiness then times out, which is expected and checked.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const ORCA = join(process.cwd(), 'out/bin/orca')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const check = (ok, message) => {
  if (!ok) {
    throw new Error(message)
  }
  log('ok:', message)
}
// Why no throw on exit 1: with --json the CLI prints its error document on stdout and exits 1.
const orca = (...args) => {
  let stdout
  try {
    stdout = execFileSync(ORCA, [...args, '--json'], { encoding: 'utf8', timeout: 120000 })
  } catch (error) {
    stdout = error.stdout ?? ''
  }
  return JSON.parse(stdout)
}

if (!existsSync(join(process.cwd(), 'out/cli/index.js'))) {
  throw new Error('out/cli/index.js missing; run pnpm build:cli')
}
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
let page = null
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (
    await p
      .evaluate(() => typeof window.api?.folderWorkspaces?.create === 'function')
      .catch(() => false)
  ) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.folderWorkspaces')
}

const domain = orca('domain', 'list').result.domains.find((entry) => entry.name === 'pod-smoke')
const dbtRepo = domain?.repos.find((repo) => repo.role === 'dbt')
if (!domain || !dbtRepo) {
  throw new Error('no pod-smoke domain with a dbt repo; run ui-smoke.mjs first')
}
const settings = await page.evaluate(() => window.api.settings.get())
const previous = {
  agentCmdOverrides: settings.agentCmdOverrides ?? {},
  agentDefaultArgs: settings.agentDefaultArgs ?? {}
}
await page.evaluate((input) => window.api.settings.set(input), {
  agentCmdOverrides: { ...previous.agentCmdOverrides, claude: '/bin/cat' },
  agentDefaultArgs: { ...previous.agentDefaultArgs, claude: '' }
})
const folder = await page.evaluate(
  (projectGroupId) =>
    window.api.folderWorkspaces.create({ projectGroupId, name: 'pod-folder-coordinator' }),
  domain.id
)
const folderKey = `folder:${folder.id}`
const name = `pod-folder-worker-${Date.now().toString(36)}`
let terminal = null
let created = null

try {
  // 1. a coordinator terminal in the folder workspace, bound to a fresh run
  terminal = orca('terminal', 'create', '--worktree', `id:${folderKey}`).result.terminal
  check(terminal?.handle, `coordinator terminal in ${folderKey} (${terminal?.handle})`)
  const run = orca(
    'orchestration',
    'run-create',
    '--objective',
    'folder coordinator smoke',
    '--from',
    terminal.handle
  ).result.run
  check(run?.id, `run ${run?.id} bound to the folder terminal`)
  const task = () => {
    const answer = orca(
      'orchestration',
      'task-create',
      '--run',
      run.id,
      '--task-title',
      'smoke',
      '--spec',
      'smoke',
      '--from',
      terminal.handle
    )
    if (!answer.result?.task) {
      throw new Error(`task-create: ${JSON.stringify(answer)}`)
    }
    return answer.result.task
  }

  // 2. new-child --repo: the worktree is created in the dbt repo, under the folder workspace
  const started = orca(
    'orchestration',
    'worker-start',
    '--task',
    task().id,
    '--worktree',
    'new-child',
    '--repo',
    `id:${dbtRepo.repoId}`,
    '--name',
    name,
    '--agent',
    'claude',
    '--timeout-ms',
    '20000',
    '--from',
    terminal.handle
  )
  log('worker-start answered', JSON.stringify(started).slice(0, 400))
  created = orca('worktree', 'show', '--worktree', `branch:${name}`).result?.worktree
  check(created?.repoId === dbtRepo.repoId, `worktree ${created?.id} created in dbt-demo`)
  // Why the renderer's lineage list: worktree show carries no parent, and a folder parent is
  // workspace lineage keyed by the child's workspace key.
  const lineage = await page.evaluate(() => window.api.worktrees.listLineage())
  const parent = Object.entries(
    lineage.workspaceLineage ?? lineage.workspaceLineageByChildKey ?? {}
  ).find(([child]) => child.includes(created.id))?.[1]
  check(
    JSON.stringify(parent ?? null).includes(folderKey),
    `its parent is the folder workspace (${JSON.stringify(parent ?? Object.keys(lineage))})`
  )

  // 3. without --repo: a plain answer, and nothing created
  const noRepo = orca(
    'orchestration',
    'worker-start',
    '--task',
    task().id,
    '--worktree',
    'new-child',
    '--name',
    `${name}-x`,
    '--agent',
    'claude',
    '--from',
    terminal.handle
  )
  check(
    noRepo.ok === false && /pass --repo/.test(noRepo.error?.message ?? ''),
    `without --repo: ${noRepo.error?.message}`
  )
} finally {
  if (created) {
    orca('worktree', 'rm', '--worktree', `id:${created.id}`, '--force')
  }
  if (terminal) {
    orca('terminal', 'close', '--terminal', terminal.handle)
  }
  await page.evaluate(
    (id) => window.api.folderWorkspaces.delete({ folderWorkspaceId: id }),
    folder.id
  )
  await page.evaluate((input) => window.api.settings.set(input), previous)
}
log('done')
await browser.close()
