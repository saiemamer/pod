// Set up a Pod domain in a running Pod started with --remote-debugging-port (the installed
// app: `open -a Pod --args --remote-debugging-port=9334`; the dev instance uses 9333).
// Imports the folder as a project group, saves roles, teams, env and dbt defaults through
// the same IPC the dialog uses, then opens Domain settings for a screenshot.
// Env: POD_CDP (port), POD_PARENT, POD_NAME, POD_REPOS (comma separated paths),
// POD_ROLES (path=role,...), POD_TEAMS (comma separated), POD_ENV (KEY=value;...),
// POD_DBT_PROFILES_DIR, POD_DBT_TARGET, POD_OUT (screenshot dir).
import { createRequire } from 'node:module'
const require = createRequire(`${process.env.HOME}/Projects/pod/package.json`)
const { chromium } = require('playwright')

const port = process.env.POD_CDP ?? '9334'
const PARENT = process.env.POD_PARENT
const NAME = process.env.POD_NAME ?? 'MEX'
const REPOS = (process.env.POD_REPOS ?? '').split(',').filter(Boolean)
const ROLES = Object.fromEntries(
  (process.env.POD_ROLES ?? '')
    .split(',')
    .filter(Boolean)
    .map((pair) => pair.split('='))
)
const TEAMS = (process.env.POD_TEAMS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)
const ENV = Object.fromEntries(
  (process.env.POD_ENV ?? '')
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return [pair.slice(0, eq), pair.slice(eq + 1)]
    })
)
const OUT = process.env.POD_OUT ?? process.cwd()
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!PARENT || REPOS.length === 0) {
  throw new Error('POD_PARENT and POD_REPOS are required')
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const pages = browser.contexts().flatMap((c) => c.pages())
let page = null
for (const p of pages) {
  const ok = await p
    .evaluate(() => typeof window.api?.ae?.domains?.list === 'function')
    .catch(() => false)
  if (ok) {
    page = p
    break
  }
}
if (!page) {
  throw new Error('no page with window.api.ae')
}
page.setDefaultTimeout(30000)
await page.keyboard.press('Escape')

// 1. project group
let group = (await page.evaluate(() => window.api.projectGroups.list())).find(
  (g) => g.name === NAME
)
if (!group) {
  const imported = await page.evaluate((args) => window.api.projectGroups.importNested(args), {
    parentPath: PARENT,
    groupName: NAME,
    projectPaths: REPOS,
    mode: 'group'
  })
  log('importNested:', JSON.stringify(imported).slice(0, 400))
  group = (await page.evaluate(() => window.api.projectGroups.list())).find((g) => g.name === NAME)
}
if (!group) {
  throw new Error('group not created')
}
log('group:', group.id, group.parentPath)
const repos = (await page.evaluate(() => window.api.repos.list())).filter(
  (r) => r.projectGroupId === group.id
)
log(
  'repos in group:',
  JSON.stringify(repos.map((r) => ({ id: r.id, path: r.path, name: r.displayName })))
)

// 2. domain config through the same IPC the dialog uses
const detected = await page.evaluate(
  (groupId) => window.api.ae.domains.detectRoles({ groupId }),
  group.id
)
log('detected roles:', JSON.stringify(detected))
const roleRows = repos.map((repo) => ({
  repoId: repo.id,
  role: ROLES[repo.path] ?? detected.find((d) => d.repoId === repo.id)?.role ?? 'other'
}))
const dbt = {}
if (process.env.POD_DBT_PROFILES_DIR) {
  dbt.profilesDir = process.env.POD_DBT_PROFILES_DIR
}
if (process.env.POD_DBT_TARGET) {
  dbt.target = process.env.POD_DBT_TARGET
}
const saved = await page.evaluate((input) => window.api.ae.domains.save(input), {
  id: group.id,
  name: NAME,
  repos: roleRows,
  stakeholderTeams: TEAMS,
  env: ENV,
  dbt
})
log('saved domain:', JSON.stringify({ ...saved, env: Object.keys(saved.env) }))

// 3. look at it through the dialog
const groupButton = page.locator(`[aria-label="Group actions for ${NAME}"]`)
await groupButton.first().waitFor({ state: 'attached' })
await page.getByText(NAME, { exact: true }).first().hover()
await sleep(300)
await groupButton.first().click({ force: true })
await page.getByRole('menuitem', { name: 'Domain settings…' }).click()
const dialog = page.getByRole('dialog')
await dialog.getByText('Domain settings').first().waitFor()
await sleep(500)
await page.screenshot({ path: `${OUT}/mex-1-domain-settings.png` })
log('dialog:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 600))
await page.keyboard.press('Escape')
await dialog.waitFor({ state: 'detached' })
await page.screenshot({ path: `${OUT}/mex-2-sidebar.png` })
await browser.close()
log('done')
