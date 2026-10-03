// Pod: tests for pod-sync-upstream.mjs. Run with `node --test config/pod-sync-upstream.test.mjs`.
// Each test builds an upstream repo with two tags and a Pod clone with Pod's commits on the
// older one, then runs the script as a person or the drift workflow would.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

const SCRIPT = resolve(import.meta.dirname, 'pod-sync-upstream.mjs')
const roots = []

function makeEnv(root) {
  const globalConfig = join(root, 'gitconfig')
  writeFileSync(globalConfig, '')
  // Why: a developer's global config (commit signing, rebase.updateRefs) must not leak in.
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com'
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pod-sync-test-'))
  roots.push(root)
  const env = makeEnv(root)
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  const write = (dir, files) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
  }
  const read = (dir, path) => readFileSync(join(dir, path), 'utf8')
  const commit = (dir, message, files = {}) => {
    write(dir, files)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', message)
  }
  const up = join(root, 'orca')
  const pod = join(root, 'pod')
  mkdirSync(up)
  git(up, 'init', '-q', '-b', 'main')
  const sync = (...args) => {
    const report = join(root, 'report.json')
    rmSync(report, { force: true })
    const result = spawnSync(process.execPath, [SCRIPT, ...args, '--report', report], {
      cwd: pod,
      env,
      encoding: 'utf8'
    })
    return {
      code: result.status,
      output: result.stdout + result.stderr,
      report: existsSync(report) ? JSON.parse(read(root, 'report.json')) : null
    }
  }
  return { up, pod, git, write, read, commit, sync }
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true })
  }
})

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

const upstreamPackage = (version, scripts, dependencies) =>
  json({ name: 'orca', version, scripts, dependencies })

const ATTRIBUTES = '/config/scripts/**/*.mjs text eol=lf\n'
const POD_ATTRIBUTES =
  "# Pod: keep Pod's front page across rebases (driver configured in docs/pod/README.md)\nREADME.md merge=pod-keep\n"

const builderConfig = (protocols, appIdLine = "const appId = 'com.stablyai.orca'") =>
  [
    'const devChannelRepo = null',
    appIdLine,
    'module.exports = {',
    '  appId,',
    "  productName: 'Orca',",
    `  protocols: ${protocols},`,
    '  win: {',
    "    executableName: 'Orca',",
    '  },',
    '  dmg: {',
    "    artifactName: 'orca-macos-${arch}.${ext}'",
    '  },',
    '  publish: {',
    "    owner: 'stablyai',",
    "    repo: devChannelRepo ?? 'orca',",
    '  }',
    '}',
    ''
  ].join('\n')

const podBuilderConfig = (text) =>
  text
    .replace(
      "const appId = 'com.stablyai.orca'",
      "const podBrand = require('./pod-brand.cjs') // Pod: brand constants live in one file\nconst appId = podBrand.appId"
    )
    .replace("productName: 'Orca'", 'productName: podBrand.productName')
    .replace("executableName: 'Orca'", 'executableName: podBrand.productName')
    .replace('orca-macos-', 'pod-macos-')
    .replace("owner: 'stablyai'", 'owner: podBrand.releaseOwner')
    .replace("?? 'orca'", '?? podBrand.releaseRepo')

const brandFiles = (tag) => ({
  'config/pod-brand.cjs': `module.exports = {\n  productName: 'Pod',\n  upstreamBaseTag: '${tag}'\n}\n`,
  'src/shared/brand.ts': `export const POD_UPSTREAM_BASE_TAG = '${tag}'\n`
})

// Orca v1.0.0 with Pod's commits on top, then Orca v1.1.0 editing next to each Pod touch.
function forkedRepos({ podPackageExtra = {}, nextAppIdLine } = {}) {
  const f = fixture()
  const { up, pod, git, read, commit } = f
  commit(up, 'orca 1.0.0', {
    'package.json': upstreamPackage(
      '1.0.0',
      { test: 'vitest run', lint: 'oxlint' },
      { tweetnacl: '^1.0.3', ws: '^8.0.0' }
    ),
    '.gitattributes': ATTRIBUTES,
    'config/electron-builder.config.cjs': builderConfig("[{ name: 'Orca' }]"),
    '.github/workflows/pr.yml': 'name: pr\n',
    'src/app.ts': "export const greeting = 'hello'\n"
  })
  git(up, 'tag', 'v1.0.0')

  git(dirname(pod), 'clone', '-q', up, pod)
  git(pod, 'remote', 'rename', 'origin', 'upstream')
  commit(pod, 'pod: brand constants and identity touchpoints', {
    ...brandFiles('v1.0.0'),
    'package.json': json({
      ...JSON.parse(upstreamPackage('1.0.0', {}, {})),
      scripts: { test: 'vitest run', 'test:pod': 'vitest run --config pod', lint: 'oxlint' },
      dependencies: { tweetnacl: '^1.0.3', ws: '^8.0.0' },
      ...podPackageExtra
    }),
    '.gitattributes': ATTRIBUTES + POD_ATTRIBUTES,
    'config/electron-builder.config.cjs': podBuilderConfig(
      read(pod, 'config/electron-builder.config.cjs')
    )
  })
  mkdirSync(join(pod, '.github/workflows-upstream'))
  git(pod, 'mv', '.github/workflows/pr.yml', '.github/workflows-upstream/pr.yml')
  commit(pod, 'pod: move upstream CI aside', { '.github/workflows/pod-pr.yml': 'name: pod\n' })
  const podPackage = JSON.parse(read(pod, 'package.json'))
  podPackage.dependencies = { tweetnacl: '^1.0.3', 'vscode-jsonrpc': '9.0.2', ws: '^8.0.0' }
  commit(pod, 'pod: LSP framing library', { 'package.json': json(podPackage) })

  commit(up, 'orca 1.1.0', {
    'package.json': upstreamPackage(
      '1.1.0',
      { test: 'vitest run', 'test:e2e': 'playwright test', lint: 'oxlint' },
      { tweetnacl: '^1.0.3', ws: '^8.1.0' }
    ),
    '.gitattributes': `${ATTRIBUTES}/resources/plugins/** text eol=lf\n`,
    'config/electron-builder.config.cjs': builderConfig(
      "[{ name: 'Orca', schemes: ['orca'] }]",
      nextAppIdLine
    ),
    '.github/workflows/release.yml': 'name: release\n'
  })
  git(up, 'tag', 'v1.1.0')
  return f
}

test('re-applies Pod touches over upstream edits to the clashing files and bumps the base tag', () => {
  // Catches: a rule that takes either side whole (dropping Pod's script, dependency or
  // identity, or keeping Pod's stale version), and a sync that leaves a new upstream
  // workflow live, which brand.test.ts fails on.
  const { pod, git, read, sync } = forkedRepos()
  const mainBefore = git(pod, 'rev-parse', 'main')

  const { code, output, report } = sync('v1.1.0')

  assert.equal(code, 0, output)
  assert.equal(report.status, 'done')
  assert.equal(git(pod, 'symbolic-ref', '--short', 'HEAD'), 'sync/v1.1.0')
  assert.equal(git(pod, 'rev-parse', 'main'), mainBefore)
  assert.deepEqual(JSON.parse(read(pod, 'package.json')), {
    name: 'orca',
    version: '1.1.0',
    scripts: {
      test: 'vitest run',
      'test:pod': 'vitest run --config pod',
      'test:e2e': 'playwright test',
      lint: 'oxlint'
    },
    dependencies: { tweetnacl: '^1.0.3', 'vscode-jsonrpc': '9.0.2', ws: '^8.1.0' }
  })
  assert.deepEqual(Object.keys(JSON.parse(read(pod, 'package.json')).scripts), [
    'test',
    'test:pod',
    'test:e2e',
    'lint'
  ])
  assert.equal(
    read(pod, '.gitattributes'),
    `${ATTRIBUTES}/resources/plugins/** text eol=lf\n${POD_ATTRIBUTES}`
  )
  assert.equal(
    read(pod, 'config/electron-builder.config.cjs'),
    podBuilderConfig(builderConfig("[{ name: 'Orca', schemes: ['orca'] }]"))
  )
  assert.ok(existsSync(join(pod, '.github/workflows-upstream/release.yml')))
  assert.ok(!existsSync(join(pod, '.github/workflows/release.yml')))
  assert.match(read(pod, 'config/pod-brand.cjs'), /upstreamBaseTag: 'v1\.1\.0'/)
  assert.equal(read(pod, 'src/shared/brand.ts'), "export const POD_UPSTREAM_BASE_TAG = 'v1.1.0'\n")
  assert.equal(git(pod, 'log', '-1', '--format=%s'), 'pod(sync): rebase onto Orca v1.1.0')
  assert.equal(git(pod, 'rev-list', '--count', 'v1.1.0..HEAD'), '4')
  assert.equal(git(pod, 'status', '--porcelain'), '')
  assert.deepEqual(
    report.resolved.map((entry) => [entry.subject, entry.files.sort()]),
    [
      [
        'pod: brand constants and identity touchpoints',
        ['.gitattributes', 'config/electron-builder.config.cjs', 'package.json']
      ],
      ['pod: LSP framing library', ['package.json']]
    ]
  )
})

test('stops instead of guessing when a Pod commit changes package.json outside Pod keys', () => {
  // Catches: a package.json rule that silently drops (or keeps) a Pod change the register
  // does not list, here an engines bump riding along in the brand commit.
  const { pod, sync } = forkedRepos({ podPackageExtra: { engines: { node: '24' } } })

  const { code, output, report } = sync('v1.1.0')

  assert.equal(code, 2, output)
  assert.equal(report.status, 'stopped')
  assert.equal(report.commit.subject, 'pod: brand constants and identity touchpoints')
  const packageStop = report.needsPerson.find((entry) => entry.path === 'package.json')
  assert.match(packageStop.reason, /engines/)
  assert.ok(existsSync(join(pod, '.git/rebase-merge')), 'the rebase is left in progress')
  assert.match(output, /--continue/)
})

test('stops when upstream reworded a line Pod touches in electron-builder.config.cjs', () => {
  // Catches: re-applying an identity touch to the wrong line, or skipping it, after
  // upstream changes the line the touch replaces.
  const { sync } = forkedRepos({
    nextAppIdLine: "const appId = process.env.ORCA_APP_ID ?? 'com.stablyai.orca'"
  })

  const { code, output, report } = sync('v1.1.0')

  assert.equal(code, 2, output)
  const stop = report.needsPerson.find(
    (entry) => entry.path === 'config/electron-builder.config.cjs'
  )
  assert.match(stop.reason, /const appId = 'com\.stablyai\.orca'/)
})

test('a stop on a file without a rule can be resolved by hand and finished with --continue', () => {
  // Catches: a stop that aborts or loses the rebase, and a --continue that does not
  // finish the job (base tag bump, workflow move) once the person has resolved the file.
  const f = forkedRepos()
  const { up, pod, git, read, commit, write, sync } = f
  commit(pod, 'pod: greet in Pod', { 'src/app.ts': "export const greeting = 'hello from Pod'\n" })
  commit(up, 'orca 1.2.0', { 'src/app.ts': "export const greeting = 'hello from Orca'\n" })
  git(up, 'tag', 'v1.2.0')

  const first = sync('v1.2.0')
  assert.equal(first.code, 2, first.output)
  assert.equal(first.report.commit.subject, 'pod: greet in Pod')
  assert.deepEqual(first.report.needsPerson, [
    { path: 'src/app.ts', reason: 'no rule for this file' }
  ])

  write(pod, { 'src/app.ts': "export const greeting = 'hello from Pod and Orca'\n" })
  git(pod, 'add', 'src/app.ts')
  const second = sync('--continue')

  assert.equal(second.code, 0, second.output)
  assert.equal(read(pod, 'src/shared/brand.ts'), "export const POD_UPSTREAM_BASE_TAG = 'v1.2.0'\n")
  assert.ok(existsSync(join(pod, '.github/workflows-upstream/release.yml')))
  assert.equal(git(pod, 'log', '-1', '--format=%s'), 'pod(sync): rebase onto Orca v1.2.0')
  assert.equal(git(pod, 'status', '--porcelain'), '')
})

test('refuses to rebase main itself', () => {
  // Catches: a --branch value that would rewrite main in place.
  const { pod, git, sync } = forkedRepos()
  const mainBefore = git(pod, 'rev-parse', 'main')

  const { code, report } = sync('v1.1.0', '--branch', 'main')

  assert.equal(code, 1)
  assert.match(report.error, /refusing to rebase main/)
  assert.equal(git(pod, 'rev-parse', 'main'), mainBefore)
})

test('refuses a --branch value that git would read as an option', () => {
  // Catches: `--branch --orphan` reaching `git checkout -b` as a flag instead of a name.
  const { pod, git, sync } = forkedRepos()
  const branchesBefore = git(pod, 'branch', '--list')

  const { code, output } = sync('v1.1.0', '--branch', '--orphan')

  assert.equal(code, 1)
  assert.match(output, /--branch needs a value that does not start with a dash/)
  assert.equal(git(pod, 'branch', '--list'), branchesBefore)
})
