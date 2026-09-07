import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
const pages = browser.contexts().flatMap((c) => c.pages())
log(
  'pages:',
  pages.map((p) => p.url())
)
let page = null
for (const p of pages) {
  const hasApi = await p
    .evaluate(() => typeof window.api?.ae?.domains?.list === 'function')
    .catch(() => false)
  if (hasApi) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae')
}
page.setDefaultTimeout(30000)

// 0. close anything left open, drop empty pod-smoke groups from earlier runs
await page.keyboard.press('Escape')
await sleep(300)
const cleanup = await page.evaluate(async () => {
  const groups = await window.api.projectGroups.list()
  const repos = await window.api.repos.list()
  const removed = []
  for (const g of groups.filter((g) => g.name === 'pod-smoke')) {
    if (!repos.some((r) => r.projectGroupId === g.id)) {
      await window.api.projectGroups.delete({ groupId: g.id })
      removed.push(g.id)
    }
  }
  const remaining = (await window.api.projectGroups.list()).filter((g) => g.name === 'pod-smoke')
  return { removed, remaining: remaining.map((g) => g.id) }
})
log('cleanup:', JSON.stringify(cleanup))

// 1. project group from the parent folder (once)
if (cleanup.remaining.length === 0) {
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
  log('importNested:', JSON.stringify(imported).slice(0, 300))
}

const groupButton = page.locator('[aria-label="Group actions for pod-smoke"]')
await groupButton.first().waitFor({ state: 'attached' })
const openGroupMenu = async () => {
  await page.getByText('pod-smoke', { exact: true }).first().hover()
  await sleep(300)
  await groupButton.first().click({ force: true })
}
await openGroupMenu()
await page.getByRole('menuitem', { name: 'Domain settings…' }).click()
const dialog = page.getByRole('dialog')
await dialog.getByText('Domain settings').first().waitFor()
await dialog.getByRole('button', { name: 'Detect roles' }).click()
for (let i = 0; i < 40; i++) {
  const text = await dialog.innerText()
  if (text.includes('dbt') && text.includes('omni') && !text.includes('Detecting')) {
    break
  }
  await sleep(250)
}
await page.screenshot({ path: `${OUT}/smoke-1-domain-settings.png` })
log('dialog text:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
await dialog.getByRole('button', { name: 'Save', exact: true }).click()
await dialog.waitFor({ state: 'detached' })
const domains = await page.evaluate(() => window.api.ae.domains.list())
log('domains:', JSON.stringify(domains.map((d) => ({ id: d.id, name: d.name, repos: d.repos }))))
if (
  !domains.some(
    (d) => d.repos.some((r) => r.role === 'dbt') && d.repos.some((r) => r.role === 'omni')
  )
) {
  throw new Error('roles not detected')
}

// 2. new initiative
await openGroupMenu()
await page.getByRole('menuitem', { name: 'New initiative…' }).click()
const dialog2 = page.getByRole('dialog')
await dialog2.getByText('New initiative').first().waitFor()
await dialog2.getByRole('textbox').first().fill('Smoke initiative')
await dialog2.locator('input').nth(1).fill('Channels')
await page.screenshot({ path: `${OUT}/smoke-2-new-initiative.png` })
await dialog2.getByRole('button', { name: 'Start initiative' }).click()
await dialog2.waitFor({ state: 'detached', timeout: 60000 })
const initiatives = await page.evaluate(() => window.api.ae.initiatives.list())
log(
  'initiatives:',
  JSON.stringify(
    initiatives.map((i) => ({
      title: i.title,
      status: i.status,
      team: i.stakeholderTeam,
      folder: i.folderPath,
      ws: i.coordinatorWorkspaceKey
    }))
  )
)
const smoke = initiatives.find((i) => i.title === 'Smoke initiative')
if (!smoke) {
  throw new Error('initiative not saved')
}
const md = `${smoke.folderPath}/INITIATIVE.md`
log('INITIATIVE.md exists:', existsSync(md))
if (existsSync(md)) {
  log('INITIATIVE.md head:', readFileSync(md, 'utf8').split('\n').slice(0, 6).join(' | '))
}

// 3. initiative panel
await sleep(2000)
const tab = page.locator('[aria-label="Initiative"]')
await tab.first().waitFor({ state: 'visible', timeout: 30000 })
await tab.first().click()
await page.getByText('Smoke initiative').first().waitFor()
await sleep(1500)
await page.screenshot({ path: `${OUT}/smoke-3-initiative-panel.png` })
const panelText = await page.evaluate(() => document.body.innerText)
log(
  'panel has status control:',
  panelText.includes('Status'),
  '| has folder:',
  panelText.includes('initiatives/smoke-initiative')
)
log('active workspace:', await page.evaluate(() => document.title))
await browser.close()
log('done')
