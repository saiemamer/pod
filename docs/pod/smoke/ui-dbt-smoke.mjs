// Phase 2 smoke: open a model in the pod-smoke dbt repo, press Cmd+Enter and
// Cmd+Shift+Enter, read the results dock, then the second slice: language-server
// completion inside ref(), Cmd-click to the referenced model, grid sort, search,
// hidden columns and CSV export, and the dock's drag handle. Needs `pnpm dev` with
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
// Why close first: a tall dock left by the lineage smoke pushes the visible lines under
// the editor header, and the click lands on that header instead.
const leftover = page.locator('[data-testid="pod-dbt-dock"] [aria-label="Close results"]')
if (await leftover.count()) {
  await leftover.first().click()
  await sleep(400)
}
await editor.click()
await sleep(500)
await page.screenshot({ path: `${OUT}/dbt-1-editor.png` })

// 3. Cmd+Enter with no selection runs the model
await page.keyboard.press(`${MOD}+Enter`)
const dock = page.locator('[data-testid="pod-dbt-dock"]')
await dock.waitFor({ state: 'visible' })
// Why an absolute height: the height persists across runs, and a tall dock left by
// another smoke hides the editor lines the next steps click.
const currentHeight = (await dock.boundingBox())?.height ?? 0
const dockHandle = dock.locator('[data-testid="pod-dbt-dock-handle"]')
const handleBox = await dockHandle.boundingBox()
if (handleBox && Math.abs(currentHeight - 260) > 4) {
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + (currentHeight - 260), {
    steps: 8
  })
  await page.mouse.up()
  await sleep(300)
}
// Why the status text: on a re-run the previous rows stay visible, dimmed, until dbt answers.
await dock.getByText(/^orders: \d+ rows/).waitFor({ state: 'visible', timeout: 20000 })
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
log('connection tab:', (await dock.innerText()).replace(/\n+/g, ' | ').slice(0, 600))

// 6. language server: wait until the Connection tab says running (first run downloads it)
const lspStatus = dock.locator('[data-testid="pod-dbt-lsp-status"]')
for (let i = 0; i < 60 && !/running/.test(await lspStatus.innerText()); i += 1) {
  await sleep(2000)
}
log('lsp:', await lspStatus.innerText())

// 7. completion: click inside the model name in ref('…') and ask for suggestions
// Why scroll first: Monaco only renders visible lines, and a tall dock can push line 4 out.
await editor.click()
await page.keyboard.press(`${MOD}+ArrowUp`)
await sleep(300)
const refToken = page
  .locator('.monaco-editor .view-line')
  .getByText('stg_orders', { exact: false })
  .first()
await refToken.click()
await page.keyboard.press('Control+Space')
const suggest = page.locator('.monaco-editor .suggest-widget')
await suggest.waitFor({ state: 'visible', timeout: 15000 })
await sleep(800)
await page.screenshot({ path: `${OUT}/dbt-6-completion.png` })
log('suggestions:', (await suggest.innerText()).replace(/\n+/g, ' | ').slice(0, 200))
await page.keyboard.press('Escape')
await suggest.waitFor({ state: 'hidden' })
// Why move away: Monaco's hover widget sits over the token after the click and would take the next click.
await page.mouse.move(5, 5)
await sleep(400)

// 8. Cmd-click the referenced model name opens models/stg_orders.sql
await refToken.click({ modifiers: [MOD] })
await sleep(2000)
await page.screenshot({ path: `${OUT}/dbt-7-goto-ref.png` })
const openedTitle = await page.evaluate(() => document.title)
const stgVisible = await page
  .getByText('stg_orders.sql', { exact: false })
  .first()
  .isVisible()
  .catch(() => false)
log('after Cmd-click: stg_orders.sql tab visible =', stgVisible, '| title =', openedTitle)
const stgContent = await page.evaluate(() =>
  [...document.querySelectorAll('.monaco-editor .view-line')]
    .map((l) => l.textContent ?? '')
    .join(' ')
    .slice(0, 80)
)
log('editor now shows:', stgContent)

// 9. back to orders.sql, rerun the model, then sort, search, hide a column, export
await page.getByText('orders.sql', { exact: true }).first().click()
await sleep(1000)
await editor.click()
await page.keyboard.press(`${MOD}+Enter`)
await dock.getByText(/^orders: \d+ rows/).waitFor({ state: 'visible', timeout: 20000 })
await dock.getByRole('columnheader', { name: 'status' }).getByRole('button').click()
await sleep(300)
const firstStatus = await dock.getByRole('row').nth(1).innerText()
log('after sort by status, first row:', firstStatus.replace(/\n+/g, ' | '))
await dock.getByRole('textbox', { name: 'Search rows' }).fill('paid')
await sleep(300)
log('after search "paid":', await dock.locator('[data-testid="pod-dbt-grid-count"]').innerText())
await dock.getByRole('button', { name: 'Columns' }).click()
await page.getByRole('menuitemcheckbox', { name: 'amount' }).click()
await page.keyboard.press('Escape')
await sleep(300)
log(
  'headers after hiding amount:',
  (await dock.getByRole('columnheader').allInnerTexts()).join(',')
)
await page.screenshot({ path: `${OUT}/dbt-8-grid-tools.png` })
await dock.getByRole('button', { name: 'Export CSV' }).click()
await sleep(1500)
const csvPath = `${PARENT}/dbt-demo/target/orders_results.csv`
const { readFileSync } = await import('node:fs')
log('exported csv:', JSON.stringify(readFileSync(csvPath, 'utf8')))
await page.screenshot({ path: `${OUT}/dbt-9-export.png` })

// 10. drag the handle up by 120px and read the dock height
const before = (await dock.boundingBox())?.height ?? 0
const handle = dock.locator('[data-testid="pod-dbt-dock-handle"]')
const box = await handle.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 6 })
await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 })
await page.mouse.up()
await sleep(500)
const after = (await dock.boundingBox())?.height ?? 0
log(`dock height ${before} -> ${after}`)
await page.screenshot({ path: `${OUT}/dbt-10-resized.png` })
// Why drag back: the height persists, so leave the dock as it was found for the next run.
const box2 = await handle.boundingBox()
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
await page.mouse.down()
await page.mouse.move(box2.x + box2.width / 2, box2.y + (after - before), { steps: 8 })
await page.mouse.up()
await sleep(300)
log('dock height restored to', (await dock.boundingBox())?.height)
await browser.close()
log('done')
