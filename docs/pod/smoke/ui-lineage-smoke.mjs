// Phase 3 smoke: open a model in the pod-smoke dbt repo, show the Lineage tab with
// Cmd+Alt+L, click a column and read the lit path, collapse and restore a side, open
// the upstream/downstream list, then the Database tab in the right sidebar: expand a
// relation, filter, and jump to another model's lineage. Last, a model with 500
// columns must open fitted with its neighbours in view, bounded nodes and layer
// labels. Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333 and the stand-in dbt at ~/Projects/pod-smoke/bin/dbt (see
// README.md). POD_SMOKE_PYTHON sets the python command; without it, Pod finds a Python
// itself and the engine label must still read sqlglot (the copy Pod ships). Screenshots go to POD_SMOKE_OUT.
import { createRequire } from 'node:module'
import { openExplorerFile, primaryWorktreeRow } from './smoke-sidebar.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { checkWideLineage } from './lineage-wide-smoke-step.mjs'
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
// order_statuses and status_report make stg_orders a shared parent (a diamond)
ensure(
  `${repo}/models/marts/order_statuses.sql`,
  "select distinct status from {{ ref('stg_orders') }}\n"
)
ensure(
  `${repo}/models/marts/status_report.sql`,
  "select s.status, count(c.order_id) as n\nfrom {{ ref('order_statuses') }} s\nleft join {{ ref('orders_by_customer') }} c on c.status = s.status\ngroup by 1\n"
)
ensure(
  `${repo}/models/sources.yml`,
  'version: 2\nsources:\n  - name: raw\n    tables:\n      - name: orders\n        identifier: orders_raw\n      - name: events\n        identifier: events_raw\n'
)
// a chain of wide models (the stand-in's catalog gives them 500, 500 and 400 columns)
mkdirSync(`${repo}/models/staging/events`, { recursive: true })
mkdirSync(`${repo}/models/intermediate`, { recursive: true })
ensure(
  `${repo}/models/staging/events/events_base.sql`,
  "select * from {{ source('raw', 'events') }}\n"
)
ensure(
  `${repo}/models/intermediate/events_enriched.sql`,
  "select * from {{ ref('events_base') }}\n"
)
ensure(`${repo}/models/fct_events.sql`, "select * from {{ ref('events_base') }}\n")

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

// 1. settings: the stand-in dbt and, when given, a python command
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
await (await primaryWorktreeRow(page, `${PARENT}/dbt-demo`)).click()
await sleep(1500)
await openExplorerFile(page, ['models', 'marts', 'orders.sql'])
const editor = page.locator('.monaco-editor .view-lines').filter({ visible: true }).first()
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
// Why the manifest check: one written before events_base joined the stand-in lacks the wide chain.
const stale =
  !existsSync(`${repo}/target/catalog.json`) ||
  !existsSync(`${repo}/target/manifest.json`) ||
  !readFileSync(`${repo}/target/manifest.json`, 'utf8').includes('model.demo.events_base')
if (stale) {
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
// Why throw: these steps only logged counts, and a node sliding off screen passed silently.
const expectCount = async (label, want) => {
  const got = await nodes.count()
  log(label, got)
  if (got !== want) {
    throw new Error(`${label} ${got}, expected ${want}`)
  }
}
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
// 4b. column lineage runs on sqlglot with no python command set (Pod ships sqlglot)
const engineLabel = dock.locator('[data-testid="pod-lineage-engine"]')
const engineDeadline = Date.now() + 60000
while ((await engineLabel.innerText()) !== 'sqlglot' && Date.now() < engineDeadline) {
  await sleep(500)
}
const engineText = await engineLabel.innerText()
if (engineText !== 'sqlglot') {
  throw new Error(
    `engine label reads "${engineText}" (${await engineLabel.getAttribute('title')}), expected sqlglot`
  )
}
log('engine:', await engineLabel.getAttribute('title'))
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
// Why ratios: the canvas opens fitted, which is 100 % only when the graph fits at 100 %.
const zooms = zoomSteps.map((label) => Number.parseInt(label, 10))
const tenPercent = [1.1, 1.1, 1 / 1.1, 1 / 1.1].every(
  (ratio, i) => Math.abs(zooms[i + 1] - zooms[i] * ratio) <= 1
)
if (!tenPercent || zooms[4] !== zooms[0]) {
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
// Why no force and a canvas check: a side button once moved its own node off the
// canvas, and a forced click landed on the sidebar beside it without failing.
const STG = 'model.demo.stg_orders'
const stgNode = dock.locator(`[data-node-id="${STG}"]`)
const stgSide = stgNode.locator('[data-testid="pod-lineage-side-up"]')
const expectStgInside = async (label) => {
  const canvas = await dock.locator('.react-flow').boundingBox()
  const box = await stgNode.boundingBox()
  const inside =
    !!canvas &&
    !!box &&
    box.x >= canvas.x &&
    box.x + box.width <= canvas.x + canvas.width &&
    box.y >= canvas.y &&
    box.y + box.height <= canvas.y + canvas.height
  log(label, box ? `stg_orders at ${Math.round(box.x)},${Math.round(box.y)}` : 'gone', inside)
  if (!inside) {
    throw new Error(`${label} stg_orders left the canvas`)
  }
}
// Samples a node's screen position every frame while its side button re-lays out the
// graph; the node should hold still in x and y, not drift and come back.
const clickSideSampled = async (label, id = STG, button = stgSide) => {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`)
    const samples = []
    window.__podDrift = samples
    const tick = () => {
      if (window.__podDrift !== samples) {
        return
      }
      const r = (document.querySelector(`[data-node-id="${id}"]`) ?? el).getBoundingClientRect()
      samples.push([r.x, r.y])
      requestAnimationFrame(tick)
    }
    tick()
  }, id)
  await button.click({ timeout: 5000 })
  await sleep(600)
  const samples = await page.evaluate(() => {
    const taken = window.__podDrift
    window.__podDrift = null
    return taken
  })
  const [x0, y0] = samples[0]
  const drift = Math.max(...samples.map(([x, y]) => Math.hypot(x - x0, y - y0)))
  log(label, `largest drift ${drift.toFixed(1)} px over ${samples.length} frames`)
  if (drift > 4) {
    throw new Error(`${label} ${id} drifted ${drift.toFixed(1)} px`)
  }
}
await centreOn('stg_orders')
await clickSideSampled('collapse:')
await expectCount('nodes after collapsing stg_orders parents:', 3)
await expectStgInside('after collapse:')
await clickSideSampled('restore:')
await expectCount('nodes after restoring:', 4)
await expectStgInside('after restore:')

// 6c. a side button that brings the selected node back must not re-centre on it: the
// view would pull the clicked button out from under the pointer
const ORDERS = 'model.demo.orders'
const ordersSide = ordersNode.locator('[data-testid="pod-lineage-side-up"]')
await centreOn('stg_orders')
// Why pan off it: a re-centre on a node already centred would move nothing.
const flow = await dock.locator('.react-flow').boundingBox()
await page.mouse.move(flow.x + 30, flow.y + flow.height - 30)
await page.mouse.down()
await page.mouse.move(flow.x + 150, flow.y + flow.height - 60, { steps: 6 })
await page.mouse.up()
await sleep(300)
await clickSideSampled('hide the selected stg_orders:', ORDERS, ordersSide)
await expectCount('nodes after collapsing orders parents:', 2)
await clickSideSampled('bring the selected stg_orders back:', ORDERS, ordersSide)
await expectCount('nodes after restoring orders parents:', 4)

// 6a. a dragged node ignores the layout, so its own side button must not move it
const header = stgNode.locator('text=stg_orders').first()
const before = await header.boundingBox()
const undragged = await stgNode.boundingBox()
await page.mouse.move(before.x + 10, before.y + 5)
await page.mouse.down()
await page.mouse.move(before.x + 10, before.y + 85, { steps: 6 })
await page.mouse.up()
await sleep(300)
const dragged = await stgNode.boundingBox()
log('drag moved stg_orders down by:', `${Math.round(dragged.y - undragged.y)} px`)
if (dragged.y - undragged.y < 40) {
  throw new Error('the drag did not move stg_orders')
}
await stgSide.click({ timeout: 5000 })
await sleep(600)
const afterDragClick = await stgNode.boundingBox()
const dragShift = Math.hypot(afterDragClick.x - dragged.x, afterDragClick.y - dragged.y)
log('dragged stg_orders moved by its side button:', `${dragShift.toFixed(1)} px`)
if (dragShift > 2) {
  throw new Error(`a dragged stg_orders moved ${dragShift.toFixed(1)} px`)
}
await stgSide.click({ timeout: 5000 })
await sleep(600)
await dock.getByRole('button', { name: 'Arrange' }).first().click()
await sleep(800)

// 6b. depth 1 leaves the source out and puts a "+1" handle on stg_orders; clicking it loads it
await dock.locator('[data-testid="pod-lineage-depth-up"]').waitFor({ state: 'visible' })
const depthUp = async () =>
  Number(await dock.locator('[data-testid="pod-lineage-depth-up"]').innerText())
while ((await depthUp()) > 1) {
  await dock.getByRole('button', { name: 'One level less' }).first().click()
  await sleep(400)
}
await sleep(800)
await expectCount('nodes at upstream depth 1:', 3)
await centreOn('stg_orders')
log('stg_orders side handle reads:', await stgSide.innerText())
await stgSide.click({ timeout: 5000 })
await sleep(1200)
await expectCount('nodes after loading one more level:', 4)
await expectStgInside('after loading one more level:')
const downHandle = await stgNode.locator('[data-testid="pod-lineage-side-down"]').innerText()
log('stg_orders downstream handle after the load:', downHandle)
// Why +2: orders_by_customer and order_statuses; orders is already on the canvas.
if (downHandle !== '+2') {
  throw new Error(`stg_orders downstream handle reads ${downHandle}, expected +2`)
}
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

// 8c. a shared parent: status_report at upstream depth 1 shows orders_by_customer and
// order_statuses, both fed by stg_orders. Loading stg_orders through one of them must
// draw its edge to the other and clear the other's "+1".
const statusRow = panel
  .locator('[data-testid="pod-dbt-explorer-relation"]', { hasText: 'status_report' })
  .first()
await statusRow.hover()
await statusRow.getByRole('button', { name: 'Show lineage' }).click({ force: true })
await sleep(2500)
const view = page.locator('[data-testid="pod-lineage-view"]:visible').first()
const viewNodes = view.locator('[data-testid="pod-lineage-node"]')
const viewDepthUp = async () =>
  Number(await view.locator('[data-testid="pod-lineage-depth-up"]').innerText())
while ((await viewDepthUp()) > 1) {
  await view.getByRole('button', { name: 'One level less' }).first().click()
  await sleep(400)
}
await sleep(800)
const expectViewCount = async (label, want) => {
  const got = await viewNodes.count()
  log(label, got)
  if (got !== want) {
    throw new Error(`${label} ${got}, expected ${want}`)
  }
}
await expectViewCount('status_report nodes at upstream depth 1:', 3)
const sideOf = (name, side) =>
  view.locator(`[data-node-id="model.demo.${name}"] [data-testid="pod-lineage-side-${side}"]`)
const statusesUp = sideOf('order_statuses', 'up')
log('order_statuses upstream handle before:', await statusesUp.innerText())
if ((await statusesUp.innerText()) !== '+1') {
  throw new Error('order_statuses should start with one parent not loaded')
}
// Why the tree: the depth change leaves orders_by_customer outside the viewport.
await view.locator('[data-testid="pod-lineage-tree-toggle"]').click()
await view
  .locator('[data-testid="pod-lineage-tree"] button', { hasText: 'orders_by_customer' })
  .first()
  .click()
await sleep(600)
await sideOf('orders_by_customer', 'up').click({ timeout: 5000 })
await sleep(1200)
await expectViewCount('nodes after loading stg_orders:', 4)
const sharedEdge = view.locator(
  '[data-testid="rf__edge-n:model.demo.stg_orders->model.demo.order_statuses"]'
)
const statusesAfter = await statusesUp.innerText()
log(
  'shared parent: edge to order_statuses drawn',
  (await sharedEdge.count()) === 1,
  '| order_statuses upstream handle:',
  statusesAfter
)
await page.screenshot({ path: `${OUT}/lineage-7-diamond.png` })
if ((await sharedEdge.count()) !== 1) {
  throw new Error('stg_orders -> order_statuses is missing after loading stg_orders')
}
if (statusesAfter.startsWith('+')) {
  throw new Error(`order_statuses upstream handle still reads ${statusesAfter}`)
}
while ((await viewDepthUp()) < 4) {
  await view.getByRole('button', { name: 'One level more' }).first().click()
  await sleep(400)
}
await view.locator('[data-testid="pod-lineage-tree-toggle"]').click()

// 8d. a model with 500 columns opens fitted (lineage-wide-smoke-step.mjs)
await checkWideLineage({ page, panel, out: OUT, log, sleep })

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
