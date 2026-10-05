// A group made the way "New group from project" makes one (a name, no folder) must show the dbt
// repo as dbt and start an initiative under ~/Pod. A start that fails must say so in plain words,
// leave no record, and a second press must make exactly one initiative. Run after ui-smoke.mjs.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const GROUP = 'pod-smoke-no-folder'
const TITLE = 'Pod smoke test'
const POD_GROUP_FOLDER = join(process.env.HOME, 'Pod', GROUP)
const FOLDER = join(POD_GROUP_FOLDER, 'initiatives', 'pod-smoke-test')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
if (existsSync(POD_GROUP_FOLDER)) {
  throw new Error(`${POD_GROUP_FOLDER} exists from an earlier run; remove it first`)
}

const repo = await page.evaluate(
  async (path) => (await window.api.repos.list()).find((entry) => entry.path === path),
  `${PARENT}/dbt-demo`
)
if (!repo) {
  throw new Error('no dbt-demo project; run ui-smoke.mjs first')
}
// What "New group from project" does: a group with a name only, then the project moves in.
const group = await page.evaluate(
  (name) => window.api.projectGroups.create({ name, createdFrom: 'manual' }),
  GROUP
)
await page.evaluate(
  (args) => window.api.projectGroups.moveProject({ projectId: args.repo, groupId: args.group }),
  { repo: repo.id, group: group.id }
)
log('group:', group.id, 'parentPath:', group.parentPath)

const failures = []
const expect = (ok, what) => {
  log(ok ? 'PASS' : 'FAIL', what)
  if (!ok) {
    failures.push(what)
  }
}
const groupButton = page.locator(`[aria-label="Group actions for ${GROUP}"]`)
const openGroupMenu = async () => {
  await page.getByText(GROUP, { exact: true }).first().hover()
  await sleep(300)
  await groupButton.first().click({ force: true })
}

try {
  await groupButton.first().waitFor({ state: 'attached' })

  // 1. Domain settings on a group with no domain yet: the dbt repo reads dbt without Detect.
  await openGroupMenu()
  await page.getByRole('menuitem', { name: 'Domain settings…' }).click()
  const settings = page.getByRole('dialog')
  await settings.getByText('Domain settings').first().waitFor()
  await settings.getByRole('combobox').first().waitFor()
  const role = (await settings.getByRole('combobox').first().innerText()).trim()
  await page.screenshot({ path: `${OUT}/group-initiative-1-roles.png` })
  expect(role === 'dbt', `Domain settings shows dbt-demo as dbt (got "${role}")`)
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'detached' })

  // 2. New initiative shows where the folder goes; a file in the way makes the start fail.
  mkdirSync(POD_GROUP_FOLDER, { recursive: true })
  writeFileSync(join(POD_GROUP_FOLDER, 'initiatives'), 'in the way\n')
  await openGroupMenu()
  await page.getByRole('menuitem', { name: 'New initiative…' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('New initiative').first().waitFor()
  await dialog.getByRole('textbox').first().fill(TITLE)
  await dialog.locator('input').nth(1).fill('Support')
  await dialog.getByText(`Folder: ${FOLDER}`).waitFor()
  expect(true, `dialog shows Folder: ${FOLDER}`)
  await dialog.getByRole('button', { name: 'Start initiative' }).click()
  const error = dialog.locator('p.text-destructive')
  await error.waitFor()
  const errorText = await error.innerText()
  await page.screenshot({ path: `${OUT}/group-initiative-2-error.png` })
  log('error:', errorText)
  expect(!errorText.includes('Error invoking remote method'), 'error has no IPC wrapper text')
  expect(errorText.includes('a file with that name is in the way'), 'error says what failed')
  const afterFailure = await page.evaluate(
    (domainId) => window.api.ae.initiatives.list({ domainId }),
    group.id
  )
  expect(
    afterFailure.length === 0,
    `no initiative record after the failed start (${afterFailure.length})`
  )

  // 3. Clear the obstacle and press Start again: one initiative, in Pod's folder.
  rmSync(join(POD_GROUP_FOLDER, 'initiatives'))
  await dialog.getByRole('button', { name: 'Start initiative' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 60000 })
  const initiatives = await page.evaluate(
    (domainId) => window.api.ae.initiatives.list({ domainId }),
    group.id
  )
  log(
    'initiatives:',
    JSON.stringify(initiatives.map((i) => ({ title: i.title, folder: i.folderPath })))
  )
  expect(initiatives.length === 1, `exactly one initiative after the retry (${initiatives.length})`)
  expect(initiatives[0]?.folderPath === FOLDER, 'initiative folder is under ~/Pod')
  expect(existsSync(join(FOLDER, 'INITIATIVE.md')), 'INITIATIVE.md written')
  await sleep(1500)
  await page.screenshot({ path: `${OUT}/group-initiative-3-started.png` })
} finally {
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.evaluate(
    async (args) => {
      for (const initiative of await window.api.ae.initiatives.list({ domainId: args.group })) {
        const id = initiative.coordinatorWorkspaceKey?.replace(/^folder:/, '')
        if (id) {
          await window.api.folderWorkspaces.delete({ folderWorkspaceId: id })
        }
      }
      await window.api.ae.domains.remove({ domainId: args.group })
      // Its old order too: a move without one puts the project last in the group.
      await window.api.projectGroups.moveProject({
        projectId: args.repo,
        groupId: args.previous ?? null,
        order: args.order
      })
      await window.api.projectGroups.delete({ groupId: args.group })
    },
    {
      group: group.id,
      repo: repo.id,
      previous: repo.projectGroupId,
      order: repo.projectGroupOrder
    }
  )
  rmSync(POD_GROUP_FOLDER, { recursive: true, force: true })
  await browser.close()
}
if (failures.length > 0) {
  throw new Error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
}
log('done')
