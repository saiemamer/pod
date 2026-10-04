// Lineage smoke step (run by ui-lineage-smoke.mjs after the Database tab is open):
// a model with 500 columns opens fitted: on the first ready frame the focus and its
// direct neighbours sit inside the canvas, the nodes list six columns and "+n more", and
// each header names its layer. At 100 % the two 500-column children overflowed it.
export async function checkWideLineage({ page, panel, out, log, sleep }) {
  const eventsRow = panel
    .locator('[data-testid="pod-dbt-explorer-relation"]', { hasText: 'events_base' })
    .first()
  await eventsRow.hover()
  await eventsRow.getByRole('button', { name: 'Show lineage' }).click({ force: true })
  const firstFrame = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const started = performance.now()
        const tick = () => {
          const focus = document.querySelector('[data-node-id="model.demo.events_base"]')
          const view = focus?.closest('[data-testid="pod-lineage-view"]')
          const canvas = view?.querySelector('[data-testid="pod-lineage-canvas"]')
          if (canvas?.getAttribute('data-ready') === 'true') {
            const flow = view.querySelector('.react-flow').getBoundingClientRect()
            const boxes = {}
            for (const el of view.querySelectorAll('[data-testid="pod-lineage-node"]')) {
              const r = el.getBoundingClientRect()
              boxes[el.dataset.nodeId] = {
                inside:
                  r.left >= flow.left - 0.5 &&
                  r.right <= flow.right + 0.5 &&
                  r.top >= flow.top - 0.5 &&
                  r.bottom <= flow.bottom + 0.5,
                box: [r.left, r.top, r.width, r.height].map(Math.round).join(','),
                layer: el.dataset.layer ?? null
              }
            }
            resolve({
              flow: [flow.left, flow.top, flow.width, flow.height].map(Math.round).join(','),
              zoom: view.querySelector('[data-testid="pod-lineage-zoom"]')?.textContent ?? '',
              boxes
            })
          } else if (performance.now() - started > 30000) {
            reject(new Error('the events_base lineage never became ready'))
          } else {
            requestAnimationFrame(tick)
          }
        }
        tick()
      })
  )
  log('wide lineage first frame: canvas', firstFrame.flow, 'zoom', firstFrame.zoom)
  for (const [id, entry] of Object.entries(firstFrame.boxes)) {
    log(' ', id, entry.box, entry.inside ? 'inside' : 'OUTSIDE', entry.layer ?? '(no layer)')
  }
  const neighbourhood = [
    'model.demo.events_base',
    'source.demo.raw.events',
    'model.demo.events_enriched',
    'model.demo.fct_events'
  ]
  for (const id of neighbourhood) {
    if (!firstFrame.boxes[id]?.inside) {
      throw new Error(`${id} is not inside the canvas on the first frame (zoom ${firstFrame.zoom})`)
    }
  }
  if (Number.parseInt(firstFrame.zoom, 10) < 60) {
    throw new Error(`the wide lineage opened below the 60 % floor: ${firstFrame.zoom}`)
  }
  const layers = {
    'model.demo.events_base': 'staging',
    'model.demo.events_enriched': 'intermediate',
    'model.demo.fct_events': 'mart',
    'source.demo.raw.events': 'source'
  }
  for (const [id, want] of Object.entries(layers)) {
    if (firstFrame.boxes[id].layer !== want) {
      throw new Error(`${id} layer ${firstFrame.boxes[id].layer}, expected ${want}`)
    }
  }
  await page.screenshot({ path: `${out}/lineage-8-wide.png` })
  const wideView = page.locator('[data-testid="pod-lineage-view"]:visible').first()
  const eventsNode = wideView.locator('[data-node-id="model.demo.events_base"]')
  const eventsRows = eventsNode.locator('[data-testid="pod-lineage-column"]')
  const more = eventsNode.locator('[data-testid="pod-lineage-more-columns"]')
  log('events_base rows:', await eventsRows.count(), '|', await more.innerText())
  if ((await eventsRows.count()) !== 6 || (await more.innerText()) !== '+494 more columns') {
    throw new Error('events_base should list 6 columns and "+494 more columns"')
  }
  // expanded: a filter and a bounded scroll area; the filter narrows it
  await more.click()
  const filterBox = eventsNode.locator('[data-testid="pod-lineage-column-filter"]')
  await filterBox.waitFor({ state: 'visible' })
  const scrollHeight = (
    await eventsNode.locator('[data-testid="pod-lineage-column-scroll"]').boundingBox()
  )?.height
  await filterBox.fill('col_30')
  await sleep(300)
  const filtered = await eventsRows.count()
  log('expanded: scroll area', Math.round(scrollHeight ?? 0), 'px, rows for "col_30":', filtered)
  if (filtered !== 10) {
    throw new Error(`filtering col_30 left ${filtered} rows, expected 10`)
  }
  // a lit column deep in the list stays visible after collapsing again
  await eventsRows.filter({ hasText: 'col_300' }).first().click()
  const litDeep = eventsNode.locator('[data-testid="pod-lineage-column"][data-lit="true"]', {
    hasText: 'col_300'
  })
  await litDeep.waitFor({ state: 'visible', timeout: 15000 })
  await eventsNode.locator('[data-testid="pod-lineage-fewer-columns"]').click()
  await sleep(400)
  const collapsedRows = await eventsRows.count()
  log(
    'collapsed with col_300 lit:',
    collapsedRows,
    'rows, col_300 visible',
    await litDeep.isVisible(),
    '| lit on events_enriched:',
    await wideView
      .locator(
        '[data-node-id="model.demo.events_enriched"] [data-testid="pod-lineage-column"][data-lit="true"]'
      )
      .allInnerTexts()
  )
  await page.screenshot({ path: `${out}/lineage-9-wide-lit.png` })
  if (collapsedRows !== 6 || !(await litDeep.isVisible())) {
    throw new Error('the lit col_300 should stay among the 6 rows after collapsing')
  }
}
