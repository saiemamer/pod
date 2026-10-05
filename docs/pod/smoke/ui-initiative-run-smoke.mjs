// Initiative run smoke: start an initiative with omni-demo unticked, then drive one task
// through its states with the real `orca` CLI and read the Initiative panel. INITIATIVE.md
// must list dbt-demo only, the task row must name the worker's copy, and the row must move to
// `completed` without "Refresh tasks". Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333,
// `pnpm build:cli`, and the pod-smoke group from ui-smoke.mjs. Workers get the same `/bin/sh`
// stand-in as orchestration-folder-worker-smoke.mjs, so no worker agent starts.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const ORCA = join(process.cwd(), 'out/bin/orca')
const TITLE = 'Smoke run initiative'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
    await p.evaluate(() => typeof window.api?.ae?.domains?.list === 'function').catch(() => false)
  ) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae')
}
page.setDefaultTimeout(30000)

const domain = orca('domain', 'list').result.domains.find((entry) => entry.name === 'pod-smoke')
const dbtRepo = domain?.repos.find((repo) => repo.role === 'dbt')
if (!domain || !dbtRepo || !domain.repos.some((repo) => repo.role === 'omni')) {
  throw new Error('no pod-smoke domain with dbt and omni repos; run ui-smoke.mjs first')
}
const repos = await page.evaluate(() => window.api.repos.list())
const omniName = repos.find(
  (repo) => repo.id === domain.repos.find((entry) => entry.role === 'omni').repoId
).displayName

const initiativeFolder = `${PARENT}/initiatives/smoke-run-initiative`
const forgetSmokeInitiatives = () =>
  page.evaluate(async (title) => {
    for (const initiative of await window.api.ae.initiatives.list()) {
      if (initiative.title !== title) {
        continue
      }
      const id = initiative.coordinatorWorkspaceKey?.replace(/^folder:/, '')
      if (id) {
        await window.api.folderWorkspaces.delete({ folderWorkspaceId: id })
      }
      await window.api.ae.initiatives.remove({ initiativeId: initiative.id })
    }
  }, TITLE)
await forgetSmokeInitiatives()
rmSync(initiativeFolder, { recursive: true, force: true })

const settings = await page.evaluate(() => window.api.settings.get())
const previous = {
  agentCmdOverrides: settings.agentCmdOverrides ?? {},
  agentDefaultArgs: settings.agentDefaultArgs ?? {}
}
const name = `smoke-run-${Date.now().toString(36)}`
let terminal = null
let created = null

try {
  // 1. New initiative with omni-demo unticked
  await page.getByText('pod-smoke', { exact: true }).first().hover()
  await sleep(300)
  await page.locator('[aria-label="Group actions for pod-smoke"]').first().click({ force: true })
  await page.getByRole('menuitem', { name: 'New initiative…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('New initiative').first().waitFor()
  await dialog.getByRole('textbox').first().fill(TITLE)
  await dialog.getByRole('checkbox', { name: omniName }).click()
  await page.screenshot({ path: `${OUT}/initiative-run-1-dialog.png` })
  await dialog.getByRole('button', { name: 'Start initiative' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 60000 })
  const initiative = (await page.evaluate(() => window.api.ae.initiatives.list())).find(
    (entry) => entry.title === TITLE
  )
  check(
    JSON.stringify(initiative?.repoIds) === JSON.stringify([dbtRepo.repoId]),
    `the record holds dbt-demo only (${JSON.stringify(initiative?.repoIds)})`
  )
  const markdown = readFileSync(`${initiative.folderPath}/INITIATIVE.md`, 'utf8')
  const repoSection = markdown.split('## Repos')[1].split('## Goal')[0].trim()
  log('INITIATIVE.md Repos:', repoSection)
  check(
    repoSection.includes('dbt-demo') && !repoSection.includes(omniName),
    'INITIATIVE.md lists the ticked repo only'
  )

  // 2. a run with one task
  await page.evaluate((input) => window.api.settings.set(input), {
    agentCmdOverrides: {
      ...previous.agentCmdOverrides,
      claude: `/bin/sh -c 'exec /bin/cat' claude`
    },
    agentDefaultArgs: { ...previous.agentDefaultArgs, claude: '' }
  })
  terminal = orca('terminal', 'create', '--worktree', `id:${initiative.coordinatorWorkspaceKey}`)
    .result.terminal
  check(terminal?.handle, `coordinator terminal ${terminal?.handle}`)
  const run = orca('orchestration', 'run-create', '--objective', TITLE, '--from', terminal.handle)
    .result.run
  check(run?.id, `run ${run?.id}`)
  orca(
    'domain',
    'initiative-update',
    '--initiative',
    initiative.id,
    '--run',
    run.id,
    '--status',
    'running'
  )
  const task = orca(
    'orchestration',
    'task-create',
    '--run',
    run.id,
    '--task-title',
    'stg_orders lineage report',
    '--spec',
    'smoke',
    '--from',
    terminal.handle
  ).result.task
  check(task?.id, `task ${task?.id}`)

  // 3. the panel shows the task before any worker; nothing below presses "Refresh tasks"
  await page.locator('[aria-label="Initiative"]').first().click()
  await page.getByText(TITLE).first().waitFor()
  const row = page.locator('li', { hasText: 'stg_orders lineage report' })
  const rowText = async () => (await row.innerText()).replace(/\n+/g, ' | ')
  await row.getByText('ready', { exact: true }).waitFor({ timeout: 8000 })
  log('task row before the worker:', await rowText())

  // 4. the worker's copy is made and its start fails at readiness (the stand-in never answers)
  const started = orca(
    'orchestration',
    'worker-start',
    '--task',
    task.id,
    '--worktree',
    'new-child',
    '--repo',
    `id:${dbtRepo.repoId}`,
    '--name',
    name,
    '--agent',
    'claude',
    '--timeout-ms',
    '15000',
    '--from',
    terminal.handle
  )
  log('worker-start answered', JSON.stringify(started).slice(0, 200))
  created = orca('worktree', 'show', '--worktree', `branch:${name}`).result?.worktree
  check(created?.id, `worker copy ${created?.id}`)
  const cliStatus = () =>
    orca(
      'orchestration',
      'task-list',
      '--run',
      run.id,
      '--from',
      terminal.handle
    ).result.tasks.find((entry) => entry.id === task.id)?.status
  const afterStart = cliStatus()
  let changedAt = Date.now()
  await row.getByText(afterStart, { exact: true }).waitFor({ timeout: 8000 })
  await row.getByText(name).waitFor({ timeout: 8000 })
  log(`row moved to ${afterStart} in ${Date.now() - changedAt} ms:`, await rowText())
  await page.screenshot({ path: `${OUT}/initiative-run-2-worker-copy.png` })

  // 4b. the left sidebar lists the copy inside the initiative's row; collapsing hides it
  const initiativeRow = page.locator(
    `[data-worktree-virtual-row][data-worktree-id="${initiative.coordinatorWorkspaceKey}"]`
  )
  const copyLink = initiativeRow.locator(`[data-pod-folder-copy-id="${created.id}"]`)
  await copyLink.waitFor({ timeout: 8000 })
  check(
    (await copyLink.innerText()).includes(name),
    'the sidebar lists the copy under the initiative'
  )
  await initiativeRow.locator('[data-pod-folder-copies] button[aria-expanded]').click()
  await copyLink.waitFor({ state: 'detached', timeout: 8000 })
  check(true, 'collapsing the initiative copies hides the copy')
  await initiativeRow.locator('[data-pod-folder-copies] button[aria-expanded]').click()
  await copyLink.waitFor({ timeout: 8000 })
  check(
    (await page.locator(`[role="option"][data-worktree-id="${created.id}"]`).count()) > 0,
    'the copy still shows under its repo'
  )
  await page.screenshot({ path: `${OUT}/initiative-run-2b-sidebar-copy.png` })

  // 5. the coordinator settles the task; the row follows within a few seconds
  const updated = orca(
    'orchestration',
    'task-update',
    '--id',
    task.id,
    '--status',
    'completed',
    '--result',
    'smoke',
    '--from',
    terminal.handle
  )
  log('task-update answered', JSON.stringify(updated).slice(0, 200))
  check(cliStatus() === 'completed', 'the CLI reads the task as completed')
  changedAt = Date.now()
  await row.getByText('completed', { exact: true }).waitFor({ timeout: 8000 })
  log(`row moved to completed in ${Date.now() - changedAt} ms:`, await rowText())
  check((await rowText()).includes(name), 'the finished row still names the worker copy')
  await page.screenshot({ path: `${OUT}/initiative-run-3-completed.png` })

  // 6. the copy link opens the worker's copy
  await row.getByRole('button', { name }).click()
  await page.waitForFunction(
    (id) => document.querySelector(`[data-worktree-id="${id}"]`) !== null,
    created.id
  )
  check(true, 'the copy link reveals the worker copy in the sidebar')
} finally {
  if (created) {
    orca('worktree', 'rm', '--worktree', `id:${created.id}`, '--force')
  }
  if (terminal) {
    orca('terminal', 'close', '--terminal', terminal.handle)
  }
  await page.evaluate((input) => window.api.settings.set(input), previous)
  await forgetSmokeInitiatives()
  rmSync(initiativeFolder, { recursive: true, force: true })
}
log('done')
await browser.close()
