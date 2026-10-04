// First-setup smoke: Settings > Analytics Tools > "Set up from repos" on two throwaway repos
// under POD_SMOKE_PARENT/setup. The dbt repo's own .venv holds a broken dbt shim and the
// folder beside it holds the stand-in dbt, so detection must skip the first. profiles.yml
// sits at the repo root with a production default target and a fake secret. The script
// detects, checks the summary, picks `dev`, applies, checks the domain and the tool path,
// then applies again and expects nothing to change. Needs `pnpm dev` with
// REMOTE_DEBUGGING_PORT=9333 (see README.md). Screenshots go to POD_SMOKE_OUT.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const PARENT = process.env.POD_SMOKE_PARENT ?? `${process.env.HOME}/Projects/pod-smoke`
const OUT = process.env.POD_SMOKE_OUT ?? process.cwd()
const ROOT = join(PARENT, 'setup')
const DBT_REPO = join(ROOT, 'dbt-setup')
const OMNI_REPO = join(ROOT, 'omni-setup')
const WORKING_DBT = join(ROOT, '.venv', 'bin', 'dbt')
const SECRET = 'pod-smoke-secret-keyfile'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const check = (ok, message) => {
  if (!ok) {
    throw new Error(message)
  }
  log('ok:', message)
}

// 0. fixtures
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
for (const [repo, files] of [
  [
    DBT_REPO,
    {
      'dbt_project.yml': 'name: setup_demo\nprofile: setup_demo\n',
      'profiles.yml': `setup_demo:\n  target: prod\n  outputs:\n    dev: {type: bigquery, method: oauth, project: smoke}\n    prod: {type: bigquery, method: service-account, keyfile: /secret/${SECRET}.json}\n`
    }
  ],
  [OMNI_REPO, { 'model.yaml': 'name: setup_demo\n' }]
]) {
  if (!existsSync(join(repo, '.git'))) {
    mkdirSync(repo, { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(repo, name), body)
    }
    git(repo, 'init', '-q')
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.email=smoke@pod', '-c', 'user.name=smoke', 'commit', '-qm', 'init')
  }
}
const brokenDbt = join(DBT_REPO, '.venv', 'bin', 'dbt')
mkdirSync(join(DBT_REPO, '.venv', 'bin'), { recursive: true })
writeFileSync(brokenDbt, '#!/nonexistent/python3\n')
chmodSync(brokenDbt, 0o755)
mkdirSync(join(ROOT, '.venv', 'bin'), { recursive: true })
copyFileSync(join(process.cwd(), 'docs/pod/smoke/dbt-stub.sh'), WORKING_DBT)
chmodSync(WORKING_DBT, 0o755)

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

const settings = await page.evaluate(() => window.api.settings.get())
const previous = { toolCmdOverrides: settings.toolCmdOverrides ?? {}, aeDbt: settings.aeDbt }
const findDomain = () =>
  page.evaluate(
    (path) =>
      Promise.all([window.api.repos.list(), window.api.ae.domains.list()]).then(
        ([repos, domains]) => {
          const repo = repos.find((r) => r.path === path)
          return domains.find((d) => d.repos.some((entry) => entry.repoId === repo?.id)) ?? null
        }
      ),
    DBT_REPO
  )
// Why remove first: a re-run should start from "no domain" so the first apply has work to do.
const stale = await findDomain()
if (stale) {
  await page.evaluate((id) => window.api.ae.domains.remove({ domainId: id }), stale.id)
}

const runSetup = async (shot) => {
  const back = page.getByText('Back to app', { exact: true })
  if (await back.isVisible().catch(() => false)) {
    await back.click()
  }
  await page.keyboard.press('Escape')
  await page.locator('[aria-label="Settings"]').first().click()
  await page.getByText('Tools', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Set up from repos' }).first().click()
  const dialog = page.getByRole('dialog')
  for (const [placeholder, value] of [
    ['~/Projects/dbt-analytics', DBT_REPO],
    ['~/Projects/omni-analytics', OMNI_REPO]
  ]) {
    const input = dialog.getByPlaceholder(placeholder)
    await input.fill(value)
    await input.press('Enter')
  }
  await dialog.getByRole('button', { name: 'Detect' }).click()
  await dialog.locator('[data-setup-item="dbt"]').waitFor()
  const item = (key) => dialog.locator(`[data-setup-item="${key}"]`)
  const dbtText = await item('dbt').innerText()
  check(dbtText.includes(WORKING_DBT), 'detection chose the dbt that runs')
  check(dbtText.includes(brokenDbt), 'and names the broken shim it skipped')
  check(
    (await item('profiles').innerText()).includes(DBT_REPO),
    'profiles.yml found at the repo root'
  )
  check(
    (await item('target').getAttribute('data-setup-status')) === 'choose',
    'the prod default is not chosen'
  )
  check(
    (await item('omniRepo').getAttribute('data-setup-status')) === 'found',
    'the Omni repo is a model repo'
  )
  check(!(await dialog.innerText()).includes(SECRET), 'no credential from profiles.yml on screen')
  await item('target').getByRole('combobox').click()
  await page.getByRole('option', { name: 'dev', exact: true }).click()
  await page.screenshot({ path: `${OUT}/setup-${shot}-summary.png` })
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await dialog.waitFor({ state: 'detached' })
}

try {
  await runSetup(1)
  await page.getByText('Domain set up', { exact: true }).waitFor()
  const domain = await findDomain()
  check(domain !== null, 'apply created the domain')
  check(
    domain.dbt?.target === 'dev' && domain.dbt?.profilesDir === DBT_REPO,
    'with the chosen target and the profiles folder'
  )
  const roles = domain.repos
    .map((entry) => entry.role)
    .sort()
    .join(',')
  check(roles === 'dbt,omni', `with both repos and their roles (${roles})`)
  const after = await page.evaluate(() => window.api.settings.get())
  check(after.toolCmdOverrides?.dbt === WORKING_DBT, 'and the working dbt as the tool path')

  await runSetup(2)
  await page.getByText('Domain already set up; nothing changed', { exact: true }).waitFor()
  const again = await findDomain()
  check(again.updatedAt === domain.updatedAt, 'a second apply leaves the domain untouched')
} finally {
  await page.evaluate((input) => window.api.settings.set(input), previous)
  await page.keyboard.press('Escape')
}
log('done; screenshots in', OUT)
await browser.close()
