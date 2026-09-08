// Phase 3 smoke: open a model in the pod-smoke dbt repo, show the Lineage tab with
// Cmd+Alt+L, click a column and read the lit path, collapse and restore a side, open
// the upstream/downstream list, then the Database tab in the right sidebar: expand a
// relation, filter, and jump to another model's lineage. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 and the stand-in dbt at ~/Projects/pod-smoke/bin/dbt (see
// README.md). POD_SMOKE_PYTHON points at a python with sqlglot; without it, name
// matching answers. Screenshots go to POD_SMOKE_OUT.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
const PYTHON = process.env.POD_SMOKE_PYTHON ?? ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 0. the smoke repo needs a source and a downstream model for the graph to be worth drawing
const repo = `${PARENT}/dbt-demo`
mkdirSync(`${repo}/models/marts`, { recursive: true })
const ensure = (file, text) => {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
    writeFileSync(file, text)
    log('wrote', file)
  }
}
ensure(
  `${repo}/models/marts/orders.sql`,
  "{{ config(materialized='table') }}\n\nwith source as (\n    select * from {{ ref('stg_orders') }}\n),\n\nfinal as (\n    select\n        order_id,\n        status,\n        amount\n    from source\n    where status != 'cancelled'\n)\n\nselect * from final\n"
)
ensure(
  `${repo}/models/stg_orders.sql`,
  "select id as order_id, status, amount from {{ source('raw', 'orders') }}\n"
)
ensure(
  `${repo}/models/marts/orders_by_customer.sql`,
  "select order_id, status, amount from {{ ref('stg_orders') }} where status = 'paid'\n"
)
ensure(
  `${repo}/models/marts/order_summary.sql`,
  "select status, count(*) as n from {{ ref('orders') }} group by 1\n"
)
ensure(
  `${repo}/models/sources.yml`,
  'version: 2\nsources:\n  - name: raw\n    tables:\n      - name: orders\n        identifier: orders_raw\n'
)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const pages = browser.contexts().flatMap((c) => c.pages())
let page = null
for (const p of pages) {
  const ok = await p
    .evaluate(() => typeof window.api?.ae?.dbt?.graph === 'function')
    .catch(() => false)
  if (ok) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.dbt.graph')
}
page.setDefaultTimeout(30000)
await page.keyboard.press('Escape')
await sleep(300)

// 1. settings: the stand-in dbt and, when given, a python with sqlglot
await page.evaluate(
  ([dbt, python]) =>
    window.api.settings.set({
      toolCmdOverrides: python ? { dbt, python } : { dbt }
    }),
  [DBT_STUB, PYTHON]
)
const groups = await page.evaluate(() => window.api.projectGroups.list())
if (!groups.some((g) => g.name === 'pod-smoke')) {
  await page.evaluate(
    async (parent) =>
      window.api.projectGroups.importNested({
        parentPath: parent,
        groupName: 'pod-smoke',
        projectPaths: [`${parent}/dbt-demo`, `${parent}/omni-demo`],
        mode: 'group'
      }),
    PARENT
  )
  log('imported pod-smoke group')
}

// 2. activate dbt-demo's primary worktree and open models/marts/orders.sql
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
for (const [i, name] of ['models', 'marts', 'orders.sql'].entries()) {
  const node = page.getByText(name, { exact: true }).first()
  await node.waitFor({ state: 'visible' })
  const next = ['models', 'marts', 'orders.sql'][i + 1]
  const child = next ? page.getByText(next, { exact: true }).first() : null
  if (!child || !(await child.isVisible())) {
    await node.click()
    await sleep(500)
  }
}
const editor = page.locator('.monaco-editor .view-lines').first()
await editor.waitFor({ state: 'visible', timeout: 120000 })
// Why close first: a dock left open by an earlier run covers the editor's lines.
const leftover = page.locator('[data-testid="pod-dbt-dock"] [aria-label="Close results"]')
if (await leftover.count()) {
  await leftover.first().click()
  await sleep(400)
}
await editor.click()
await sleep(500)

// 3. the warmup runs parse + docs generate once per session; force it when target/ is gone
for (let i = 0; i < 15 && !existsSync(`${repo}/target/catalog.json`); i += 1) {
  await sleep(1000)
}
if (!existsSync(`${repo}/target/catalog.json`)) {
  const refreshed = await page.evaluate(
    (path) => window.api.ae.dbt.ensureCatalog({ path, force: true }),
    `${repo}/models/marts/orders.sql`
  )
  log('forced catalog refresh:', refreshed.outcome, refreshed.commands.join(', '))
}
log('catalog on disk:', existsSync(`${repo}/target/catalog.json`))

// 4. Cmd+Alt+L opens the dock on the Lineage tab; grow the dock so the canvas has room
await page.keyboard.press(`${MOD}+Alt+L`)
const dock = page.locator('[data-testid="pod-dbt-dock"]')
await dock.waitFor({ state: 'visible' })
const startHeight = (await dock.boundingBox())?.height ?? 0
// Why an absolute target: the height persists, so a relative drag would grow it every run.
const grow = Math.max(0, 520 - startHeight)
const handle = dock.locator('[data-testid="pod-dbt-dock-handle"]')
const box = await handle.boundingBox()
if (grow > 0 && box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y - grow, { steps: 8 })
  await page.mouse.up()
}
const nodes = dock.locator('[data-testid="pod-lineage-node"]')
await nodes.first().waitFor({ state: 'visible', timeout: 30000 })
await sleep(1200)
const nodeIds = await nodes.evaluateAll((els) => els.map((el) => el.dataset.nodeId))
log('canvas nodes:', nodeIds.join(', '))
const legendText = async () =>
  (await dock.locator('[data-testid="pod-lineage-legend"]').innerText()).replace(/\n+/g, ' ')
log(
  'toolbar:',
  await dock.locator('[data-testid="pod-lineage-zoom"]').innerText(),
  '|',
  await legendText(),
  '|',
  await dock.locator('[data-testid="pod-lineage-engine"]').innerText()
)
await page.screenshot({ path: `${OUT}/lineage-1-canvas.png` })

// 4c. the toolbar's zoom buttons step by ten percent (pinch and wheel stay continuous)
const zoomLabel = async () => dock.locator('[data-testid="pod-lineage-zoom"]').innerText()
const zoomSteps = [await zoomLabel()]
for (const name of ['Zoom in', 'Zoom in', 'Zoom out', 'Zoom out']) {
  await dock.getByRole('button', { name }).click()
  await sleep(250)
  zoomSteps.push(await zoomLabel())
}
log('zoom steps (+ + − −):', zoomSteps.join(' → '))
if (zoomSteps.join(' ') !== '100% 110% 121% 110% 100%') {
  throw new Error(`zoom steps are not ten percent: ${zoomSteps.join(' ')}`)
}

// 5. click the status column on orders: the path lights up in both directions
const ordersNode = dock.locator('[data-node-id="model.demo.orders"]')
await ordersNode
  .locator('[data-testid="pod-lineage-column"]', { hasText: 'status' })
  .first()
  .click()
const lit = dock.locator('[data-testid="pod-lineage-column"][data-lit="true"]')
for (let i = 0; i < 20 && (await lit.count()) < 2; i += 1) {
  await sleep(500)
}
const litText = await lit.evaluateAll((els) =>
  els.map(
    (el) =>
      `${el.closest('[data-node-id]')?.dataset.nodeId}.${el.textContent?.trim().split(/\s/)[0]}`
  )
)
log('lit columns:', litText.join(', '))
await sleep(400)
await page.screenshot({ path: `${OUT}/lineage-2-column.png` })

// 4b. the tab underline is one element that slides: its offset changes between tabs
const indicator = dock.locator('[data-testid="pod-dbt-tab-indicator"]')
const indicatorX = async () => (await indicator.boundingBox())?.x ?? -1
const atLineage = await indicatorX()
await dock.getByRole('tab', { name: 'Connection' }).click()
await sleep(400)
const atConnection = await indicatorX()
await dock.getByRole('tab', { name: 'Lineage' }).click()
await sleep(400)
log(
  'tab indicator x: lineage',
  atLineage,
  '-> connection',
  atConnection,
  '-> lineage',
  await indicatorX()
)

// Why: the Lineage view stays mounted across tabs, so coming back is instant and in place
log(
  'lineage views mounted after the round trip:',
  await dock.locator('[data-testid="pod-lineage-view"]').count(),
  '| canvas ready:',
  await dock.locator('[data-testid="pod-lineage-canvas"]').getAttribute('data-ready')
)

// 5b. the same canvas in dark mode: swap the theme classes the app toggles (the live
// window retheme runs from the renderer's settings store, not from the settings file)
await page.evaluate(() => {
  const root = document.documentElement
  root.classList.remove('light')
  root.classList.add('dark')
})
await sleep(600)
await page.screenshot({ path: `${OUT}/lineage-3c-dark.png` })
await page.evaluate(() => {
  const root = document.documentElement
  root.classList.remove('dark')
  root.classList.add('light')
})
await sleep(300)

// 6. the upstream/downstream list, then collapse and restore the parents of stg_orders
await dock.locator('[data-testid="pod-lineage-tree-toggle"]').click()
await dock.locator('[data-testid="pod-lineage-tree"]').waitFor({ state: 'visible' })
log(
  'tree:',
  (await dock.locator('[data-testid="pod-lineage-tree"]').innerText()).replace(/\n+/g, ' | ')
)
await page.screenshot({ path: `${OUT}/lineage-3-tree.png` })
const centreOn = async (name) => {
  await dock.locator('[data-testid="pod-lineage-tree"] button', { hasText: name }).first().click()
  await sleep(600)
}
await centreOn('stg_orders')
const stgSide = dock.locator(
  '[data-node-id="model.demo.stg_orders"] [data-testid="pod-lineage-side-up"]'
)
await stgSide.click({ force: true })
await sleep(600)
log('nodes after collapsing stg_orders parents:', await nodes.count())
await stgSide.click({ force: true })
await sleep(600)
log('nodes after restoring:', await nodes.count())

// 6b. depth 1 leaves the source out and puts a "+1" handle on stg_orders; clicking it loads it
await dock.locator('[data-testid="pod-lineage-depth-up"]').waitFor({ state: 'visible' })
const depthUp = async () =>
  Number(await dock.locator('[data-testid="pod-lineage-depth-up"]').innerText())
while ((await depthUp()) > 1) {
  await dock.getByRole('button', { name: 'One level less' }).first().click()
  await sleep(400)
}
await sleep(800)
log('nodes at upstream depth 1:', await nodes.count())
await centreOn('stg_orders')
const loadMore = dock.locator(
  '[data-node-id="model.demo.stg_orders"] [data-testid="pod-lineage-side-up"]'
)
log('stg_orders side handle reads:', await loadMore.innerText())
await loadMore.click({ force: true })
await sleep(1200)
log('nodes after loading one more level:', await nodes.count())
await page.screenshot({ path: `${OUT}/lineage-3b-expand.png` })
while ((await depthUp()) < 4) {
  await dock.getByRole('button', { name: 'One level more' }).first().click()
  await sleep(400)
}
await dock.locator('[data-testid="pod-lineage-tree-toggle"]').click()
await sleep(300)

// 7. the Database tab in the right sidebar
const databaseTab = page.locator('[aria-label^="Database"]').first()
await databaseTab.click()
const panel = page.locator('[data-testid="pod-dbt-explorer"]')
await panel.waitFor({ state: 'visible' })
await panel
  .locator('[data-testid="pod-dbt-explorer-relation"]')
  .first()
  .waitFor({ state: 'visible', timeout: 20000 })
await panel
  .locator('[data-testid="pod-dbt-explorer-relation"]', { hasText: 'orders' })
  .first()
  .click()
await sleep(400)
log('explorer:', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
await page.screenshot({ path: `${OUT}/lineage-4-explorer.png` })
await panel.getByRole('textbox', { name: 'Filter relations and columns' }).fill('status')
await sleep(400)
log('explorer filtered:', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
await panel.getByRole('textbox', { name: 'Filter relations and columns' }).fill('')
await sleep(300)

// 8. "Show lineage" on order_summary opens the model and points the dock at its lineage
const summaryRow = panel
  .locator('[data-testid="pod-dbt-explorer-relation"]', {
    hasText: 'order_summary'
  })
  .first()
await summaryRow.hover()
await summaryRow.getByRole('button', { name: 'Show lineage' }).click({ force: true })
await sleep(2500)
const focusName = await page
  .locator('[data-testid="pod-lineage-view"]')
  .first()
  .innerText()
  .then((t) => t.split('\n')[0])
  .catch(() => 'n/a')
log(
  'lineage view after explorer jump, first line:',
  focusName,
  '| title:',
  await page.evaluate(() => document.title)
)
await page.screenshot({ path: `${OUT}/lineage-5-summary.png` })

// 8b. stg_orders feeds two models: its lineage shows them stacked to the right
const stgRow = panel
  .locator('[data-testid="pod-dbt-explorer-relation"]', { hasText: 'stg_orders' })
  .first()
await stgRow.hover()
await stgRow.getByRole('button', { name: 'Show lineage' }).click({ force: true })
await sleep(2500)
const fanNodes = page.locator('[data-testid="pod-lineage-view"] [data-testid="pod-lineage-node"]')
const fanBoxes = await fanNodes.evaluateAll((els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect()
    return `${el.dataset.nodeId}@${Math.round(r.x)},${Math.round(r.y)}`
  })
)
log('fan-out boxes:', fanBoxes.join(' | '))
await page.screenshot({ path: `${OUT}/lineage-6-fanout.png` })
log(
  'legend:',
  await page
    .locator('[data-testid="pod-lineage-legend"]')
    .innerText()
    .then((t) => t.replace(/\n+/g, ' '))
)

// 9. put the dock height back for the next run
const dockNow = page.locator('[data-testid="pod-dbt-dock"]').first()
const after = (await dockNow.boundingBox())?.height ?? 0
const handle2 = dockNow.locator('[data-testid="pod-dbt-dock-handle"]')
const box2 = await handle2.boundingBox()
if (box2 && after > startHeight) {
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
  await page.mouse.down()
  await page.mouse.move(box2.x + box2.width / 2, box2.y + (after - startHeight), { steps: 8 })
  await page.mouse.up()
}
await browser.close()
log('done')
