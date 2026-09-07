// Phase 2 smoke: open a model in the pod-smoke dbt repo, press Cmd+Enter and
// Cmd+Shift+Enter, and read the results dock. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 and the stand-in dbt at ~/Projects/pod-smoke/bin/dbt
// (see README.md). Screenshots go to POD_SMOKE_OUT.
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const pages = browser.contexts().flatMap((c) => c.pages())
let page = null
for (const p of pages) {
  const ok = await p
    .evaluate(() => typeof window.api?.ae?.dbt?.show === 'function')
    .catch(() => false)
  if (ok) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.dbt')
}
page.setDefaultTimeout(30000)
await page.keyboard.press('Escape')
await sleep(300)

// 1. settings: point dbt at the stand-in, then make sure the smoke group exists
await page.evaluate((dbt) => window.api.settings.set({ toolCmdOverrides: { dbt } }), DBT_STUB)
const groups = await page.evaluate(() => window.api.projectGroups.list())
if (!groups.some((g) => g.name === 'pod-smoke')) {
  const imported = await page.evaluate(
    async (parent) =>
      window.api.projectGroups.importNested({
        parentPath: parent,
        groupName: 'pod-smoke',
        projectPaths: [`${parent}/dbt-demo`, `${parent}/omni-demo`],
        mode: 'group'
      }),
    PARENT
  )
  log('importNested:', JSON.stringify(imported).slice(0, 200))
}

// 2. activate dbt-demo's primary worktree: the `master` row between the two project rows
const rowY = async (locator) => (await locator.boundingBox())?.y ?? null
const dbtProject = page.getByText('dbt-demo', { exact: true }).first()
const omniProject = page.getByText('omni-demo', { exact: true }).first()
const findDbtWorktreeRow = async () => {
  const top = await rowY(dbtProject)
  const bottom = await rowY(omniProject)
  const rows = page.getByText('master', { exact: true })
  for (let i = 0; i < (await rows.count()); i += 1) {
    const y = await rowY(rows.nth(i))
    if (top !== null && y !== null && y > top && (bottom === null || y < bottom)) {
      return rows.nth(i)
    }
  }
  return null
}
let worktreeRow = await findDbtWorktreeRow()
if (!worktreeRow) {
  await dbtProject.click()
  await sleep(800)
  worktreeRow = await findDbtWorktreeRow()
}
if (!worktreeRow) {
  throw new Error('no worktree row under dbt-demo')
}
await worktreeRow.click()
await sleep(1500)
const explorer = page.locator('[aria-label^="Explorer"]')
if (await explorer.count()) {
  await explorer.first().click()
  await sleep(500)
}
// Why check first: the Explorer remembers expansion, so a click on an open folder closes it.
const tree = ['models', 'marts', 'orders.sql']
for (let i = 0; i < tree.length; i += 1) {
  const node = page.getByText(tree[i], { exact: true }).first()
  await node.waitFor({ state: 'visible' })
  const child = tree[i + 1] ? page.getByText(tree[i + 1], { exact: true }).first() : null
  if (!child || !(await child.isVisible())) {
    await node.click()
    await sleep(500)
  }
}
const editor = page.locator('.monaco-editor .view-lines').first()
await editor.waitFor({ state: 'visible', timeout: 120000 })
await editor.click()
await sleep(500)
await page.screenshot({ path: `${OUT}/dbt-1-editor.png` })

// 3. Cmd+Enter with no selection runs the model
await page.keyboard.press(`${MOD}+Enter`)
const dock = page.locator('[data-testid="pod-dbt-dock"]')
await dock.waitFor({ state: 'visible' })
await dock.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 20000 })
await sleep(300)
await page.screenshot({ path: `${OUT}/dbt-2-model-rows.png` })
log('dock after model run:', (await dock.innerText()).replace(/\n+/g, ' | ').slice(0, 300))

// 4. select three lines and run them inline
await editor.click()
await page.keyboard.press(`${MOD}+Home`)
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
await page.keyboard.down('Shift')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('End')
await page.keyboard.up('Shift')
await page.keyboard.press(`${MOD}+Enter`)
await sleep(2500)
await page.screenshot({ path: `${OUT}/dbt-3-inline-rows.png` })
log('dock after inline run:', (await dock.innerText()).replace(/\n+/g, ' | ').slice(0, 300))

// 5. compile the selection, then look at the Connection tab
await page.keyboard.press(`${MOD}+Shift+Enter`)
await sleep(2500)
await page.screenshot({ path: `${OUT}/dbt-4-compiled.png` })
log('dock after compile:', (await dock.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
await dock.getByRole('tab', { name: 'Connection' }).click()
await sleep(1500)
await page.screenshot({ path: `${OUT}/dbt-5-connection.png` })
log('connection tab:', (await dock.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
await browser.close()
log('done')
