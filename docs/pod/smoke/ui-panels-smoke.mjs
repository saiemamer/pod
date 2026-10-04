// Editor and panel fixes (2026-10-04): the hover on ref() is not clipped, "Show lineage"
// in the file explorer's context menu for a model file only, the Database tab survives a
// right-panel resize sequence, and the results dock follows the pointer while dragged.
// Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333 and the stand-in dbt (see README.md).
// Prints PASS/FAIL per check and exits 1 on any FAIL.
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
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

const failures = []
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) {
    failures.push(name)
  }
}
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))

// 3. Explorer: expand models/marts and right-click orders.sql
const explorer = page.locator('[aria-label^="Explorer"]').first()
await explorer.click()
await sleep(500)
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
const lineageItem = page.locator('[data-testid="pod-dbt-show-lineage"]')
await page.getByText('orders.sql', { exact: true }).first().click({ button: 'right' })
const offered = await lineageItem
  .waitFor({ state: 'visible', timeout: 5000 })
  .then(() => true)
  .catch(() => false)
check('context menu offers Show lineage on a model file', offered)
const dock = page.locator('[data-testid="pod-dbt-dock"]')
if (offered) {
  await lineageItem.click()
  const lineageTab = dock.getByRole('tab', { name: 'Lineage' })
  const opened = await lineageTab
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(async () => (await lineageTab.getAttribute('data-state')) === 'active')
    .catch(() => false)
  check('Show lineage opens the dock on its Lineage tab', opened)
} else {
  await page.keyboard.press('Escape')
}
await sleep(300)
await page.getByText('dbt_project.yml', { exact: true }).first().click({ button: 'right' })
await sleep(1500)
check('no Show lineage on dbt_project.yml', (await lineageItem.count()) === 0)
await page.keyboard.press('Escape')
await sleep(300)

// 4. hover on ref('stg_orders'): it renders in the body-level host and nothing covers it
const editor = page.locator('.monaco-editor .view-lines').first()
await editor.waitFor({ state: 'visible', timeout: 120000 })
const refToken = editor.getByText('stg_orders').first()
let hoverBox = null
for (let i = 0; i < 30 && !hoverBox; i += 1) {
  await refToken.hover()
  await sleep(1000)
  hoverBox = await page
    .locator('.monaco-hover:not(.hidden)')
    .first()
    .boundingBox()
    .catch(() => null)
}
if (!hoverBox) {
  check('language server hover appeared on ref()', false, 'no hover in 30s')
} else {
  const placement = await page.evaluate(() => {
    const hover = [...document.querySelectorAll('.monaco-hover')].find(
      (node) => node.getBoundingClientRect().width > 0
    )
    const rect = hover.getBoundingClientRect()
    const inset = 3
    const corners = [
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset]
    ]
    return {
      inHost: Boolean(hover.closest('[data-testid="pod-monaco-overflow-widgets"]')),
      inWindow:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      uncovered: corners.every(([x, y]) => hover.contains(document.elementFromPoint(x, y))),
      rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(',')
    }
  })
  await page.screenshot({ path: `${OUT}/panels-1-hover.png` })
  check('hover renders outside the clipped editor tree', placement.inHost, placement.rect)
  check('hover lies inside the window', placement.inWindow, placement.rect)
  check('hover corners are not covered', placement.uncovered, placement.rect)
}
await page.mouse.move(5, 5)

// 5. Database tab, then drag the right panel wider and narrower three times
await page.locator('[aria-label^="Database"]').first().click()
const dbPanel = page.locator('[data-testid="pod-dbt-explorer"]')
await dbPanel.waitFor({ state: 'visible' })
const handleX = async () =>
  page.evaluate(() => {
    let node = document.querySelector('[data-testid="pod-dbt-explorer"]')
    while (node && !node.querySelector(':scope > .cursor-col-resize')) {
      node = node.parentElement
    }
    const rect = node?.querySelector(':scope > .cursor-col-resize')?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })
for (const dx of [-120, 120, -120, 120, -120, 120]) {
  const at = await handleX()
  if (!at) {
    break
  }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + dx, at.y, { steps: 6 })
  await page.mouse.up()
  // Why wait: the reset arrived with the persistence echo, not during the drag.
  await sleep(1200)
}
check('Database tab still open after six right-panel resizes', await dbPanel.isVisible())
await page.screenshot({ path: `${OUT}/panels-2-database-after-resize.png` })

// 6. drag the dock: its height must equal the pointer offset at every step
const dockHandle = dock.locator('[data-testid="pod-dbt-dock-handle"]')
if (!(await dockHandle.count())) {
  check('dock handle present', false)
} else {
  const box = await dockHandle.boundingBox()
  const startHeight = (await dock.boundingBox()).height
  const x = box.x + box.width / 2
  const y0 = box.y + box.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  let worst = 0
  for (const offset of [-20, -40, -60, -80, -60, -30, 0]) {
    await page.mouse.move(x, y0 + offset)
    await frame()
    await frame()
    const height = (await dock.boundingBox()).height
    worst = Math.max(worst, Math.abs(height - (startHeight - offset)))
  }
  await page.mouse.up()
  check('dock height follows the pointer within 2 px', worst <= 2, `worst ${worst.toFixed(1)} px`)
}

await browser.close()
if (failures.length > 0) {
  log(`${failures.length} FAIL`)
  process.exit(1)
}
