// Performance run for the lineage canvas and the Database panel in the real app, over
// the DevTools port, on the fixture from perf-fixture.mjs (about 1,000 nodes). Measures
// what a reader feels: time to a ready canvas, frame times while zooming and panning,
// long tasks, IPC latency, column lineage, memory after repeated cycles, and the panel
// with a thousand relations, each against a threshold. Prints a table and PASS/FAIL,
// and writes a JSON report next to the screenshots.
//
//   POD_SMOKE_OUT=/tmp POD_SMOKE_PYTHON=/tmp/sqlglot-venv/bin/python node docs/pod/smoke/ui-lineage-perf.mjs
import { createRequire } from 'node:module'
import { existsSync, writeFileSync } from 'node:fs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const REPO = `${PARENT}/dbt-demo`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const DBT_STUB = process.env.POD_SMOKE_DBT ?? `${PARENT}/bin/dbt`
const PYTHON = process.env.POD_SMOKE_PYTHON ?? ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const FILE = `${REPO}/models/marts/orders.sql`
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!existsSync(`${REPO}/perf/manifest.json`)) {
  throw new Error('run docs/pod/smoke/perf-fixture.mjs first')
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
let page = null
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (await p.evaluate(() => typeof window.api?.ae?.dbt?.graph === 'function').catch(() => false)) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae.dbt.graph')
}
page.setDefaultTimeout(60000)
const cdp = await page.context().newCDPSession(page)
await cdp.send('HeapProfiler.enable')

// Why in-page: a long task observer must live where the tasks happen.
await page.evaluate(() => {
  window.__podLongTasks = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__podLongTasks.push({ t: entry.startTime, d: entry.duration })
    }
  })
  observer.observe({ type: 'longtask', buffered: false })
  window.__podMark = () =>
    window.__podLongTasks.length
      ? window.__podLongTasks.at(-1).t + window.__podLongTasks.at(-1).d
      : 0
  window.__podSince = (mark) =>
    window.__podLongTasks.filter((x) => x.t >= mark).map((x) => Math.round(x.d))
})
const longTasksSince = async (mark) => page.evaluate((m) => window.__podSince(m), mark)
const now = async () => page.evaluate(() => performance.now())
const heapMb = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  await sleep(200)
  const usage = await cdp.send('Runtime.getHeapUsage')
  return usage.usedSize / 1048576
}

// 1. settings: stand-in dbt, python, and the fixture through the stub's env
const settings = await page.evaluate(() => window.api.settings.get())
const previousEnv = settings.aeDbt?.env ?? {}
await page.evaluate(
  ([dbt, python, manifest, catalog]) =>
    window.api.settings.set({
      toolCmdOverrides: python ? { dbt, python } : { dbt },
      aeDbt: {
        ...window.__podSettingsAeDbt,
        env: { POD_STUB_MANIFEST: manifest, POD_STUB_CATALOG: catalog }
      }
    }),
  [DBT_STUB, PYTHON, `${REPO}/perf/manifest.json`, `${REPO}/perf/catalog.json`]
)
const restoreSettings = async () => {
  await page.evaluate((env) => window.api.settings.set({ aeDbt: { env } }), previousEnv)
}

const results = []
const record = (name, value, unit, threshold, better = 'lower') => {
  const pass = value === null ? false : better === 'lower' ? value <= threshold : value >= threshold
  results.push({ name, value, unit, threshold, pass })
  log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}: ${value === null ? 'n/a' : Math.round(value * 10) / 10} ${unit} (limit ${better === 'lower' ? '≤' : '≥'} ${threshold})`
  )
}

try {
  // 2. the fixture through dbt parse + docs generate (the stand-in copies the files)
  let t0 = await now()
  const refreshed = await page.evaluate(
    (path) => window.api.ae.dbt.ensureCatalog({ path, force: true }),
    FILE
  )
  log(
    'catalog refresh:',
    refreshed.outcome,
    refreshed.commands.join(', '),
    refreshed.manifest.nodeCount,
    'nodes'
  )

  // 3. graph IPC latency on 1,000 nodes (five runs, median)
  const graphTimes = []
  let graphResult = null
  for (let i = 0; i < 5; i += 1) {
    t0 = await now()
    graphResult = await page.evaluate((path) => window.api.ae.dbt.graph({ path }), FILE)
    graphTimes.push((await now()) - t0)
  }
  graphTimes.sort((a, b) => a - b)
  log(
    'graph:',
    graphResult.nodes.length,
    'nodes,',
    graphResult.edges.length,
    'edges, truncated',
    graphResult.truncated,
    '| times',
    graphTimes.map((t) => Math.round(t)).join(' ')
  )
  record('graph IPC, 1000-node manifest, median', graphTimes[2], 'ms', 300)

  // 4. open the editor on orders.sql, then the Lineage tab; time to a ready canvas
  const dbtProject = page.getByText('dbt-demo', { exact: true }).first()
  const omniProject = page.getByText('omni-demo', { exact: true }).first()
  const rowY = async (l) => (await l.boundingBox())?.y ?? null
  const rows = page.getByText('master', { exact: true })
  let worktreeRow = null
  for (let i = 0; i < (await rows.count()); i += 1) {
    const y = await rowY(rows.nth(i))
    const top = await rowY(dbtProject)
    const bottom = await rowY(omniProject)
    if (top !== null && y !== null && y > top && (bottom === null || y < bottom)) {
      worktreeRow = rows.nth(i)
    }
  }
  if (worktreeRow) {
    await worktreeRow.click()
  }
  await sleep(800)
  const explorerTab = page.locator('[aria-label^="Explorer"]')
  if (await explorerTab.count()) {
    await explorerTab.first().click()
  }
  await sleep(400)
  for (const [i, name] of ['models', 'marts', 'orders.sql'].entries()) {
    const node = page.getByText(name, { exact: true }).first()
    await node.waitFor({ state: 'visible' })
    const next = ['models', 'marts', 'orders.sql'][i + 1]
    const child = next ? page.getByText(next, { exact: true }).first() : null
    if (!child || !(await child.isVisible())) {
      await node.click()
      await sleep(400)
    }
  }
  const editor = page.locator('.monaco-editor .view-lines').first()
  await editor.waitFor({ state: 'visible', timeout: 120000 })
  const leftover = page.locator('[data-testid="pod-dbt-dock"] [aria-label="Close results"]')
  if (await leftover.count()) {
    await leftover.first().click()
    await sleep(400)
  }
  await editor.click()
  await sleep(300)
  let mark = await page.evaluate(() => window.__podMark())
  t0 = await now()
  await page.keyboard.press(`${MOD}+Alt+L`)
  const dock = page.locator('[data-testid="pod-dbt-dock"]')
  await dock.waitFor({ state: 'visible' })
  const readyAt = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const tick = () => {
          const c = document.querySelector('[data-testid="pod-lineage-canvas"]')
          if (c && c.dataset.ready === 'true') {
            resolve(performance.now())
          } else {
            requestAnimationFrame(tick)
          }
        }
        tick()
      })
  )
  const firstOpen = readyAt - t0
  const shown = await dock.locator('[data-testid="pod-lineage-node"]').count()
  log('first open:', Math.round(firstOpen), 'ms to ready,', shown, 'nodes on canvas')
  record(`first Lineage open to ready canvas (${shown} nodes)`, firstOpen, 'ms', 1500)
  const openTasks = await longTasksSince(mark)
  record('longest task during first open', openTasks.length ? Math.max(...openTasks) : 0, 'ms', 400)
  await page.screenshot({ path: `${OUT}/perf-1-canvas.png` })

  // 5. frame times while zooming with the wheel, then while panning with the mouse
  const pane = page.locator('.react-flow__pane').first()
  const box = await pane.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const frames = async (label, drive) => {
    await page.evaluate(() => {
      window.__podFrames = []
      let last = performance.now()
      window.__podFrameStop = false
      const tick = (t) => {
        window.__podFrames.push(t - last)
        last = t
        if (!window.__podFrameStop) {
          requestAnimationFrame(tick)
        }
      }
      requestAnimationFrame(tick)
    })
    await drive()
    const list = await page.evaluate(() => {
      window.__podFrameStop = true
      return window.__podFrames.slice(1)
    })
    const sorted = [...list].sort((a, b) => a - b)
    const avg = list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    log(
      `${label}: ${list.length} frames, avg ${avg.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, worst ${Math.max(...list).toFixed(1)} ms`
    )
    return { avg, p95, worst: Math.max(...list) }
  }
  await page.mouse.move(cx, cy)
  const zoomFrames = await frames('wheel zoom 1.2 s', async () => {
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.wheel(0, i < 12 ? -120 : 120)
      await sleep(50)
    }
  })
  record('zoom: average frame time', zoomFrames.avg, 'ms', 20)
  record('zoom: p95 frame time', zoomFrames.p95, 'ms', 33)
  const panFrames = await frames('drag pan 1.2 s', async () => {
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(cx + Math.sin(i / 3) * 220, cy + Math.cos(i / 3) * 120, { steps: 2 })
      await sleep(50)
    }
    await page.mouse.up()
  })
  record('pan: average frame time', panFrames.avg, 'ms', 20)
  record('pan: p95 frame time', panFrames.p95, 'ms', 33)
  await dock.getByRole('button', { name: 'Arrange' }).click()
  await sleep(600)

  // 6. column lineage: IPC cold and warm, then the click in the canvas
  t0 = await now()
  const cold = await page.evaluate(
    (path) => window.api.ae.dbt.columnLineage({ path, model: 'orders', column: 'status' }),
    FILE
  )
  const coldMs = (await now()) - t0
  t0 = await now()
  await page.evaluate(
    (path) => window.api.ae.dbt.columnLineage({ path, model: 'orders', column: 'amount' }),
    FILE
  )
  const warmMs = (await now()) - t0
  log(
    'column lineage:',
    cold.engine,
    cold.columns.length,
    'lit columns,',
    cold.nameMatchedNodes.length,
    'name-matched | cold',
    Math.round(coldMs),
    'ms, warm (other column, cached SQL)',
    Math.round(warmMs),
    'ms'
  )
  record(`column lineage IPC, cold, ${cold.engine}`, coldMs, 'ms', 8000)
  record('column lineage IPC, warm (SQL cached)', warmMs, 'ms', 500)
  mark = await page.evaluate(() => window.__podMark())
  const ordersNode = dock.locator('[data-node-id="model.demo.orders"]')
  t0 = await now()
  await ordersNode
    .locator('[data-testid="pod-lineage-column"]', { hasText: 'status' })
    .first()
    .click()
  const litAt = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const tick = () => {
          if (
            document.querySelectorAll('[data-testid="pod-lineage-column"][data-lit="true"]')
              .length >= 2
          ) {
            resolve(performance.now())
          } else {
            requestAnimationFrame(tick)
          }
        }
        tick()
      })
  )
  record('column click to lit path (cached SQL)', litAt - t0, 'ms', 600)
  const clickTasks = await longTasksSince(mark)
  record(
    'longest task during column highlight',
    clickTasks.length ? Math.max(...clickTasks) : 0,
    'ms',
    200
  )
  await page.screenshot({ path: `${OUT}/perf-2-highlight.png` })

  // 7. one more upstream level: the neighbourhood grows to the cap and relays out
  mark = await page.evaluate(() => window.__podMark())
  t0 = await now()
  await dock.getByRole('button', { name: 'One level more' }).first().click()
  const grownAt = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const tick = () => {
          const c = document.querySelector('[data-testid="pod-lineage-canvas"]')
          if (c && c.dataset.ready === 'true') {
            resolve(performance.now())
          } else {
            requestAnimationFrame(tick)
          }
        }
        setTimeout(tick, 50)
      })
  )
  const grownNodes = await dock.locator('[data-testid="pod-lineage-node"]').count()
  record(`depth +1 to ready canvas (${grownNodes} nodes)`, grownAt - t0, 'ms', 1500)
  const growTasks = await longTasksSince(mark)
  record(
    'longest task during depth change',
    growTasks.length ? Math.max(...growTasks) : 0,
    'ms',
    400
  )

  // 8. twenty tab round trips and ten column clicks, then memory after GC
  const heapBefore = await heapMb()
  mark = await page.evaluate(() => window.__podMark())
  for (let i = 0; i < 20; i += 1) {
    await dock.getByRole('tab', { name: 'Connection' }).click()
    await sleep(120)
    await dock.getByRole('tab', { name: 'Lineage' }).click()
    await sleep(120)
  }
  for (let i = 0; i < 10; i += 1) {
    await ordersNode
      .locator('[data-testid="pod-lineage-column"]', { hasText: i % 2 ? 'amount' : 'status' })
      .first()
      .click()
    await sleep(150)
  }
  const cycleTasks = await longTasksSince(mark)
  record(
    'longest task across 20 tab round trips + 10 clicks',
    cycleTasks.length ? Math.max(...cycleTasks) : 0,
    'ms',
    150
  )
  const heapAfter = await heapMb()
  log('heap after GC:', heapBefore.toFixed(1), '->', heapAfter.toFixed(1), 'MB')
  record('heap growth after cycles (post-GC)', heapAfter - heapBefore, 'MB', 15)

  // 9. the Database panel with a thousand relations: open, expand, filter
  mark = await page.evaluate(() => window.__podMark())
  t0 = await now()
  await page.locator('[aria-label^="Database"]').first().click()
  const panel = page.locator('[data-testid="pod-dbt-explorer"]')
  await panel
    .locator('[data-testid="pod-dbt-explorer-relation"]')
    .first()
    .waitFor({ state: 'visible' })
  const panelOpen = (await now()) - t0
  const relationRows = await panel.locator('[data-testid="pod-dbt-explorer-relation"]').count()
  record(`Database panel open (${relationRows} relation rows)`, panelOpen, 'ms', 800)
  t0 = await now()
  await panel.getByRole('textbox', { name: 'Filter relations and columns' }).fill('stg_00')
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
  const filtered = (await now()) - t0
  const filteredRows = await panel.locator('[data-testid="pod-dbt-explorer-relation"]').count()
  record(`Database panel filter to ${filteredRows} rows`, filtered, 'ms', 250)
  const panelTasks = await longTasksSince(mark)
  record(
    'longest task in the Database panel',
    panelTasks.length ? Math.max(...panelTasks) : 0,
    'ms',
    200
  )
  await panel.getByRole('textbox', { name: 'Filter relations and columns' }).fill('')
  await page.screenshot({ path: `${OUT}/perf-3-explorer.png` })
} finally {
  await restoreSettings()
  await page
    .evaluate((path) => window.api.ae.dbt.ensureCatalog({ path, force: true }), FILE)
    .catch(() => {})
}

const failed = results.filter((r) => !r.pass)
console.log(
  `\n${results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(56)} ${r.value === null ? 'n/a' : String(Math.round(r.value * 10) / 10).padStart(8)} ${r.unit.padEnd(3)} limit ${r.threshold}`).join('\n')}`
)
console.log(
  `\n${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`} (${results.length} checks)`
)
writeFileSync(
  `${OUT}/pod-perf-report.json`,
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2)
)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
