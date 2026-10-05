// First-setup smoke: Settings > Analytics Tools > "Set up from repos" on two throwaway repos
// under POD_SMOKE_PARENT/setup. The dbt repo's own .venv holds a broken dbt shim and the
// folder beside it holds the stand-in dbt, so detection must skip the first. profiles.yml
// sits at the repo root with a production default target and a fake secret. The script
// picks only the dbt repo; setup must run by itself and stop on the one question (the
// production default), then apply `dev` and show what it set up. It checks the domain and
// the tool path, adds the Omni repo from the result screen, then runs again and expects
// nothing to change. Needs `pnpm dev` with REMOTE_DEBUGGING_PORT=9333 (see README.md).
// Screenshots go to POD_SMOKE_OUT.
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

const openSetup = async () => {
  const back = page.getByText('Back to app', { exact: true })
  if (await back.isVisible().catch(() => false)) {
    await back.click()
  }
  await page.keyboard.press('Escape')
  await page.locator('[aria-label="Settings"]').first().click()
  await page.getByText('Tools', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Set up from repos' }).first().click()
  const dialog = page.getByRole('dialog')
  // The one choice: the dbt repo. No Detect or Apply button may stand between it and the result.
  check((await dialog.getByRole('button', { name: 'Detect' }).count()) === 0, 'no Detect step')
  const input = dialog.getByPlaceholder('~/Projects/dbt-analytics')
  await input.fill(DBT_REPO)
  await input.press('Enter')
  return dialog
}
const phase = (dialog, name) =>
  dialog.page().locator(`[data-setup-phase="${name}"]`).waitFor({ timeout: 60000 })
const item = (dialog, key) => dialog.locator(`[data-setup-item="${key}"]`)

try {
  const info = await page.evaluate((path) => window.api.ae.setup.repoInfo({ path }), DBT_REPO)
  check(
    info === null || (info.role === 'dbt' && info.domainId === null),
    'a dbt repo in no domain is offered setup'
  )

  let dialog = await openSetup()
  await phase(dialog, 'question')
  const dbtText = await item(dialog, 'dbt').innerText()
  check(dbtText.includes(WORKING_DBT), 'setup ran by itself and chose the dbt that runs')
  check(
    dbtText.includes(`Pod skipped ${brokenDbt}: it does not start`),
    'and names the broken shim'
  )
  check(!/\bE[A-Z]{3,}\b/.test(dbtText), 'in plain words, with no raw error code')
  check((await item(dialog, 'profiles').innerText()).includes(DBT_REPO), 'profiles.yml at the root')
  check(
    (await dialog.locator('[data-setup-question]').count()) === 1 &&
      (await dialog.locator('[data-setup-question="target"]').count()) === 1,
    'the only question is the production default target'
  )
  check(!(await dialog.innerText()).includes(SECRET), 'no credential from profiles.yml on screen')
  check((await findDomain()) === null, 'nothing is written while a question is open')
  await dialog.locator('[data-setup-question="target"]').getByRole('combobox').click()
  await page.getByRole('option', { name: 'dev', exact: true }).click()
  await page.screenshot({ path: `${OUT}/setup-1-question.png` })
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await phase(dialog, 'applied')
  await page.getByText('Domain set up', { exact: true }).waitFor()
  check(
    (await item(dialog, 'target').getAttribute('data-setup-status')) === 'found',
    'the result shows the chosen target as set up'
  )
  let domain = await findDomain()
  check(domain !== null, 'apply created the domain')
  check(
    domain.dbt?.target === 'dev' && domain.dbt?.profilesDir === DBT_REPO,
    'with the chosen target and the profiles folder'
  )
  const after = await page.evaluate(() => window.api.settings.get())
  check(after.toolCmdOverrides?.dbt === WORKING_DBT, 'and the working dbt as the tool path')

  const omniInput = dialog.getByPlaceholder('~/Projects/omni-analytics')
  await omniInput.fill(OMNI_REPO)
  await omniInput.press('Enter')
  await phase(dialog, 'question')
  await dialog.locator('[data-setup-question="target"]').getByRole('combobox').click()
  await page.getByRole('option', { name: 'dev', exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await phase(dialog, 'applied')
  check(
    (await item(dialog, 'omniRepo').getAttribute('data-setup-status')) === 'found',
    'the Omni repo added later is a model repo'
  )
  await page.screenshot({ path: `${OUT}/setup-2-applied.png` })
  domain = await findDomain()
  const roles = domain.repos
    .map((entry) => entry.role)
    .sort()
    .join(',')
  check(roles === 'dbt,omni', `the domain has both repos and their roles (${roles})`)
  await dialog.getByRole('button', { name: 'Done' }).click()
  await dialog.waitFor({ state: 'detached' })

  dialog = await openSetup()
  await phase(dialog, 'question')
  await dialog.locator('[data-setup-question="target"]').getByRole('combobox').click()
  await page.getByRole('option', { name: 'dev', exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await phase(dialog, 'applied')
  const again = await findDomain()
  check(again.updatedAt === domain.updatedAt, 'running setup again leaves the domain untouched')
  await dialog.getByRole('button', { name: 'Done' }).click()
} finally {
  await page.evaluate((input) => window.api.settings.set(input), previous)
  await page.keyboard.press('Escape')
}
log('done; screenshots in', OUT)
await browser.close()
