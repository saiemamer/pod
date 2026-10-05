#!/usr/bin/env node
// Pod: rebase Pod's commits from the current upstream base tag onto a newer Orca tag.
//
//   node config/pod-sync-upstream.mjs v1.4.219                 # onto branch sync/v1.4.219
//   node config/pod-sync-upstream.mjs v1.4.219 --branch try    # onto another new branch
//   node config/pod-sync-upstream.mjs --continue               # after resolving a stop by hand
//   ... --report out.json                                       # also write the outcome as JSON
//
// It works on the repository in the current directory, creates the branch from HEAD and
// never touches main. At each stop it resolves the files that clash on every release by
// the rules in docs/pod/sync.md; any other file, or a rule file whose clash is not the one
// the rule expects, stops it with the rebase left in progress. After a clean rebase it
// moves new upstream workflows aside and bumps the base tag in one commit.
//
// Exit 0: rebased and committed. Exit 2: stopped for a person. Exit 1: refused or failed.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/
const STATE_FILE = 'pod-sync-upstream.json'

// Mirrors the package.json row in FORK_TOUCHPOINTS.md. A Pod commit that changes any other
// key stops the sync, so a new Pod dependency goes in the register and here together.
const POD_PACKAGE_KEYS = [
  ['scripts', 'test:pod'],
  ['scripts', 'typecheck:pod'],
  ['dependencies', 'vscode-jsonrpc'],
  ['dependencies', '@xyflow/react'],
  ['dependencies', '@dagrejs/dagre']
]

// Mirrors the electron-builder row in FORK_TOUCHPOINTS.md: upstream's line, and Pod's
// replacement that reads config/pod-brand.cjs.
const ELECTRON_BUILDER_TOUCHES = [
  {
    upstream: ["const appId = 'com.stablyai.orca'"],
    pod: [
      "const podBrand = require('./pod-brand.cjs') // Pod: brand constants live in one file",
      'const appId = podBrand.appId'
    ]
  },
  { upstream: ["  productName: 'Orca',"], pod: ['  productName: podBrand.productName,'] },
  {
    upstream: ["    executableName: 'Orca',"],
    pod: ['    executableName: podBrand.productName,']
  },
  {
    upstream: ["    artifactName: 'orca-macos-${arch}.${ext}'"],
    pod: ["    artifactName: 'pod-macos-${arch}.${ext}'"]
  },
  { upstream: ["    owner: 'stablyai',"], pod: ['    owner: podBrand.releaseOwner,'] },
  {
    upstream: ["    repo: devChannelRepo ?? 'orca',"],
    pod: ['    repo: devChannelRepo ?? podBrand.releaseRepo,']
  },
  {
    upstream: ["  protocols: [{ name: 'Orca', schemes: ['orca'] }],"],
    pod: ['  protocols: [], // Pod: orca:// links open stock Orca']
  }
]

class Stop extends Error {}
class Refusal extends Error {}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_EDITOR: 'true', ...options.env },
    stdio: options.inherit ? ['ignore', 'inherit', 'inherit'] : 'pipe',
    maxBuffer: 256 * 1024 * 1024
  })
  if (result.error) {
    throw new Refusal(`${cmd} ${args.join(' ')}: ${result.error.message}`)
  }
  return result
}

function git(args, options = {}) {
  const result = run('git', args, options)
  if (result.status !== 0 && !options.allowFailure) {
    throw new Refusal(`git ${args.join(' ')} failed:\n${result.stderr ?? ''}`.trim())
  }
  return options.allowFailure ? result : result.stdout
}

const gitLines = (args) => git(args).split('\n').filter(Boolean)
const gitOk = (args) => git(args, { allowFailure: true }).status === 0
const gitPath = (name) => git(['rev-parse', '--git-path', name]).trim()

function parseArgs(argv) {
  const options = { tag: null, branch: null, report: null, continue: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--continue') {
      options.continue = true
    } else if (arg === '--branch' || arg === '--report') {
      const value = argv[++i]
      // Why the dash check: git would read a value such as `--force` as an option.
      if (!value || value.startsWith('-')) {
        throw new Refusal(`${arg} needs a value that does not start with a dash`)
      }
      options[arg.slice(2)] = value
    } else if (!arg.startsWith('-') && !options.tag) {
      options.tag = arg
    } else {
      throw new Refusal(`unknown argument ${arg}`)
    }
  }
  if (!options.continue && !options.tag) {
    throw new Refusal('usage: pod-sync-upstream.mjs <orca tag> [--branch name] | --continue')
  }
  return options
}

const versionParts = (tag) => tag.slice(1).split('.').map(Number)

function isNewerTag(tag, than) {
  const [a, b] = [versionParts(tag), versionParts(than)]
  const at = a.findIndex((part, i) => part !== b[i])
  return at !== -1 && a[at] > b[at]
}

function readBaseTag() {
  const text = readFileSync('config/pod-brand.cjs', 'utf8')
  const match = text.match(/upstreamBaseTag: '([^']+)'/)
  if (!match) {
    throw new Refusal('config/pod-brand.cjs has no upstreamBaseTag')
  }
  return match[1]
}

function rebaseInProgress() {
  return existsSync(gitPath('rebase-merge')) || existsSync(gitPath('rebase-apply'))
}

function ensureTags(tags) {
  const missing = tags.filter((tag) => !gitOk(['rev-parse', '-q', '--verify', `refs/tags/${tag}`]))
  if (missing.length === 0) {
    return
  }
  if (!gitOk(['remote', 'get-url', 'upstream'])) {
    git(['remote', 'add', 'upstream', UPSTREAM_URL])
  }
  // Why only these tags: Orca's other tags would end up pushed to saiemamer/pod by a stray
  // `git push --tags`, and pod-release.yml builds every v* tag.
  git([
    'fetch',
    '--no-tags',
    '--filter=blob:none',
    'upstream',
    ...missing.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`)
  ])
}

function start(options, report) {
  const tag = options.tag
  if (!TAG_PATTERN.test(tag)) {
    throw new Refusal(`${tag} is not an Orca stable tag (vX.Y.Z)`)
  }
  const branch = options.branch ?? `sync/${tag}`
  if (['main', 'master'].includes(branch)) {
    throw new Refusal(`refusing to rebase ${branch}; the sync goes on its own branch`)
  }
  if (rebaseInProgress()) {
    throw new Refusal(
      'a rebase is already in progress; finish it with --continue or git rebase --abort'
    )
  }
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) {
    throw new Refusal('the working tree has uncommitted changes')
  }
  if (gitOk(['rev-parse', '-q', '--verify', `refs/heads/${branch}`])) {
    throw new Refusal(`branch ${branch} already exists; delete it or pass --branch`)
  }
  const base = readBaseTag()
  Object.assign(report, { tag, base, branch })
  if (base === tag) {
    throw new Refusal(`Pod is already on ${tag}`)
  }
  if (!isNewerTag(tag, base)) {
    throw new Refusal(`${tag} is older than the base tag ${base}`)
  }
  ensureTags([base, tag])
  if (!gitOk(['merge-base', '--is-ancestor', base, 'HEAD'])) {
    throw new Refusal(`HEAD does not contain the base tag ${base}`)
  }
  // Why not --is-ancestor: each Orca release tag sits on its own release commits, so a
  // newer tag does not contain the older one. The rebase replays only base..HEAD either way.
  if (!gitOk(['merge-base', base, tag])) {
    throw new Refusal(`${tag} shares no history with the base tag ${base}`)
  }
  if (!git(['config', '--get', 'merge.pod-keep.driver'], { allowFailure: true }).stdout.trim()) {
    // Why: .gitattributes routes the top-level README.md here, keeping Pod's front page in a rebase.
    git(['config', 'merge.pod-keep.driver', 'cp %B %A'])
  }
  git(['checkout', '-q', '-b', branch])
  writeFileSync(gitPath(STATE_FILE), JSON.stringify({ tag, base, branch, resolved: [] }, null, 2))
  // Why --no-update-refs: rebase.updateRefs in a user's config would also move main.
  const result = git(['rebase', '--no-update-refs', '--onto', tag, base], {
    allowFailure: true,
    inherit: true
  })
  if (result.status !== 0 && !rebaseInProgress()) {
    rmSync(gitPath(STATE_FILE), { force: true })
    throw new Refusal(
      `git rebase could not start; see its output above (branch ${branch} was created)`
    )
  }
  return result.status === 0
}

function loadState() {
  const path = gitPath(STATE_FILE)
  if (!existsSync(path)) {
    throw new Refusal('no sync in progress; start one with an Orca tag')
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function saveState(state) {
  writeFileSync(gitPath(STATE_FILE), JSON.stringify(state, null, 2))
}

// Maps each index stage of an unmerged path to its blob id.
function unmergedEntries(path) {
  const entries = new Map()
  for (const line of git(['ls-files', '-u', '-z', '--', path]).split('\0').filter(Boolean)) {
    const [, oid, stage] = line.split('\t')[0].split(' ')
    entries.set(Number(stage), oid)
  }
  return entries
}

const blobAt = (rev, path) =>
  git(['rev-parse', '-q', '--verify', `${rev}:${path}`], { allowFailure: true }).stdout.trim() ||
  null

const showStage = (stage, path) => git(['show', `:${stage}:${path}`])

function splitLines(text) {
  const lines = text.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

function findBlock(lines, block) {
  const hits = []
  for (let i = 0; i + block.length <= lines.length; i++) {
    if (block.every((line, j) => lines[i + j] === line)) {
      hits.push(i)
    }
  }
  return hits
}

function applyLineTouches(text, touches) {
  const lines = splitLines(text)
  for (const touch of touches) {
    if (findBlock(lines, touch.pod).length > 0) {
      continue
    }
    const hits = findBlock(lines, touch.upstream)
    if (hits.length !== 1) {
      throw new Stop(
        `expected upstream's \`${touch.upstream[0].trim()}\` once, found ${hits.length}`
      )
    }
    lines.splice(hits[0], touch.upstream.length, ...touch.pod)
  }
  return `${lines.join('\n')}\n`
}

function resolveElectronBuilder({ base, ours, theirs }) {
  const present = ELECTRON_BUILDER_TOUCHES.filter(
    (touch) => findBlock(splitLines(theirs), touch.pod).length > 0
  )
  if (applyLineTouches(base, present) !== theirs) {
    throw new Stop("Pod's commit changes it beyond the identity touches")
  }
  return applyLineTouches(ours, present)
}

// Why the unanchored line too: Pod's history still adds it, and a sync replays that commit.
const POD_KEEP_LINES = ['/README.md merge=pod-keep', 'README.md merge=pod-keep']
const isPodAttributeLine = (line) => POD_KEEP_LINES.includes(line) || line.startsWith('# Pod:')

function resolveGitattributes({ base, ours, theirs }) {
  const podLines = splitLines(theirs).filter(isPodAttributeLine)
  const reapply = (text) =>
    `${[...splitLines(text).filter((line) => !isPodAttributeLine(line)), ...podLines].join('\n')}\n`
  if (reapply(base) !== theirs) {
    throw new Stop("Pod's commit changes lines other than its /README.md merge=pod-keep line")
  }
  return reapply(ours)
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function changedPackagePaths(before, after) {
  const paths = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isPlainObject(before[key]) && isPlainObject(after[key])) {
      for (const sub of new Set([...Object.keys(before[key]), ...Object.keys(after[key])])) {
        if (!same(before[key][sub], after[key][sub])) {
          paths.push([key, sub])
        }
      }
    } else if (!same(before[key], after[key])) {
      paths.push([key])
    }
  }
  return paths
}

const isPodPackageKey = (path) =>
  POD_PACKAGE_KEYS.some(([section, key]) => path[0] === section && path[1] === key)

function parsePackage(text, side) {
  const parsed = JSON.parse(text)
  if (`${JSON.stringify(parsed, null, 2)}\n` !== text) {
    throw new Stop(`${side}'s package.json is not in plain two-space JSON form`)
  }
  return parsed
}

function withKey(section, key, value, theirsSection) {
  const entries = Object.entries(section).filter(([name]) => name !== key)
  if (value === undefined) {
    return Object.fromEntries(entries)
  }
  if (key in section) {
    return Object.fromEntries(Object.entries(section).map(([k, v]) => [k, k === key ? value : v]))
  }
  // Why: put a new key after the one it follows in Pod's file, so the diff stays one line.
  const order = Object.keys(theirsSection)
  const before = order.slice(0, order.indexOf(key)).findLast((name) => name in section)
  const at = before === undefined ? 0 : entries.findIndex(([name]) => name === before) + 1
  entries.splice(at, 0, [key, value])
  return Object.fromEntries(entries)
}

function resolvePackageJson({ base, ours, theirs }) {
  const [b, o, t] = [
    parsePackage(base, 'base'),
    parsePackage(ours, 'upstream'),
    parsePackage(theirs, 'Pod')
  ]
  const foreign = changedPackagePaths(b, t).filter(
    (path) => !isPodPackageKey(path) && path[0] !== 'version'
  )
  if (foreign.length > 0) {
    throw new Stop(
      `Pod's commit changes ${foreign.map((path) => path.join('.')).join(', ')}, outside Pod's keys in FORK_TOUCHPOINTS.md`
    )
  }
  let result = o
  for (const [section, key] of POD_PACKAGE_KEYS) {
    const [bv, ov, tv] = [b[section]?.[key], o[section]?.[key], t[section]?.[key]]
    if (same(tv, bv) || same(ov, tv)) {
      continue
    }
    if (!same(ov, bv)) {
      throw new Stop(
        `upstream changed ${section}.${key} to ${JSON.stringify(ov)}; Pod has ${JSON.stringify(tv)}`
      )
    }
    if (!isPlainObject(o[section])) {
      throw new Stop(`upstream's package.json has no ${section}`)
    }
    result = { ...result, [section]: withKey(result[section], key, tv, t[section] ?? {}) }
  }
  return `${JSON.stringify(result, null, 2)}\n`
}

const MOVED_WORKFLOWS = '.github/workflows-upstream/'

// Pod's move-aside commit meets a workflow Orca has since deleted: drop it, as Orca did.
function resolveDeletedUpstreamWorkflow(path) {
  const source = `.github/workflows/${path.slice(MOVED_WORKFLOWS.length)}`
  const entries = unmergedEntries(path)
  if (entries.size !== 2 || !entries.has(1) || !entries.has(3)) {
    throw new Stop('upstream changed this moved workflow instead of deleting it')
  }
  if (entries.get(1) !== entries.get(3)) {
    throw new Stop("Pod's commit edits this workflow as well as moving it")
  }
  if (blobAt('HEAD', source) || blobAt('HEAD', path)) {
    throw new Stop('upstream still has this workflow')
  }
  if (
    blobAt('REBASE_HEAD^', source) !== entries.get(1) ||
    blobAt('REBASE_HEAD', path) !== entries.get(3)
  ) {
    throw new Stop(`Pod's commit does not move ${source} here unchanged`)
  }
  git(['rm', '-q', '-f', '--', path])
}

const RULES = {
  'package.json': resolvePackageJson,
  '.gitattributes': resolveGitattributes,
  'config/electron-builder.config.cjs': resolveElectronBuilder
}

function resolveLockfile(unresolved) {
  if (unresolved.has('package.json')) {
    throw new Stop('waits on package.json, which needs a person first')
  }
  const changedDeps = changedPackagePaths(
    JSON.parse(git(['show', 'REBASE_HEAD^:package.json'], { allowFailure: true }).stdout || '{}'),
    JSON.parse(git(['show', 'REBASE_HEAD:package.json'], { allowFailure: true }).stdout || '{}')
  ).filter((path) => isPodPackageKey(path) && path[0] === 'dependencies')
  if (changedDeps.length === 0) {
    throw new Stop("Pod's commit changes it without changing one of Pod's dependencies")
  }
  git(['checkout', '--ours', '--', 'pnpm-lock.yaml'])
  // Why --no-frozen-lockfile: pnpm freezes the lockfile by default under CI, which is the point here.
  const install = run(
    'pnpm',
    ['install', '--lockfile-only', '--no-frozen-lockfile', '--ignore-scripts'],
    {
      inherit: true
    }
  )
  if (install.status !== 0) {
    throw new Stop("pnpm install --lockfile-only failed on upstream's lockfile")
  }
  const stray = gitLines(['diff', '--name-only']).filter(
    (path) => path !== 'pnpm-lock.yaml' && !unresolved.has(path)
  )
  if (stray.length > 0) {
    throw new Stop(`pnpm install also changed ${stray.join(', ')}`)
  }
}

function currentCommit() {
  const sha = git(['rev-parse', 'REBASE_HEAD']).trim()
  const subject = git(['log', '-1', '--format=%s', sha]).trim()
  const read = (name) => {
    const path = join(gitPath('rebase-merge'), name)
    return existsSync(path) ? Number(readFileSync(path, 'utf8').trim()) : null
  }
  return { sha, subject, number: read('msgnum'), of: read('end') }
}

// Resolves what the rules cover at the current stop. Returns the files left for a person.
function resolveStop(state) {
  const conflicted = gitLines(['diff', '--name-only', '--diff-filter=U'])
  const commit = currentCommit()
  const needsPerson = []
  const resolved = []
  const unresolved = new Set(conflicted)
  const ordered = [...conflicted].sort(
    (a, b) => (a === 'pnpm-lock.yaml') - (b === 'pnpm-lock.yaml')
  )
  for (const path of ordered) {
    try {
      let label = path
      if (path === 'pnpm-lock.yaml') {
        resolveLockfile(unresolved)
        git(['add', '--', path])
      } else if (path.startsWith(MOVED_WORKFLOWS)) {
        resolveDeletedUpstreamWorkflow(path)
        label = `${path} (dropped; upstream deleted it)`
      } else if (RULES[path]) {
        const stages = unmergedEntries(path)
        if (![1, 2, 3].every((stage) => stages.has(stage))) {
          throw new Stop('one side added or deleted the file')
        }
        const content = RULES[path]({
          base: showStage(1, path),
          ours: showStage(2, path),
          theirs: showStage(3, path)
        })
        writeFileSync(path, content)
        git(['add', '--', path])
      } else {
        throw new Stop('no rule for this file')
      }
      unresolved.delete(path)
      resolved.push(label)
    } catch (error) {
      if (!(error instanceof Stop)) {
        throw error
      }
      needsPerson.push({ path, reason: error.message })
    }
  }
  if (resolved.length > 0) {
    state.resolved.push({ commit: commit.sha, subject: commit.subject, files: resolved })
    saveState(state)
  }
  return { commit, needsPerson, resolved }
}

function moveUpstreamWorkflows() {
  const moved = []
  for (const path of gitLines(['ls-files', '--', '.github/workflows'])) {
    const name = basename(path)
    if (name.startsWith('pod-')) {
      continue
    }
    const target = `.github/workflows-upstream/${name}`
    if (existsSync(target)) {
      throw new Stop(`upstream workflow ${path} also exists as ${target}`)
    }
    // Why: git mv needs the folder, which is gone if every moved workflow was dropped.
    mkdirSync(dirname(target), { recursive: true })
    git(['mv', path, target])
    moved.push(name)
  }
  return moved
}

function bumpBaseTag(file, pattern, from, to) {
  const text = readFileSync(file, 'utf8')
  const needle = pattern(from)
  if (text.split(needle).length !== 2) {
    throw new Stop(`expected \`${needle}\` once in ${file}`)
  }
  writeFileSync(file, text.replace(needle, pattern(to)))
  git(['add', '--', file])
}

function finish(state, report) {
  const moved = moveUpstreamWorkflows()
  if (readBaseTag() !== state.tag) {
    bumpBaseTag('config/pod-brand.cjs', (tag) => `upstreamBaseTag: '${tag}'`, state.base, state.tag)
    bumpBaseTag(
      'src/shared/brand.ts',
      (tag) => `POD_UPSTREAM_BASE_TAG = '${tag}'`,
      state.base,
      state.tag
    )
  }
  const body = [
    `Base tag ${state.base} -> ${state.tag} in config/pod-brand.cjs and src/shared/brand.ts.`,
    ...(moved.length > 0
      ? [`Moved new upstream workflows to .github/workflows-upstream/: ${moved.join(', ')}.`]
      : [])
  ].join('\n')
  // Why --no-verify: the lint-staged hook needs node_modules, which a sync checkout may lack.
  git(['commit', '-q', '--no-verify', '-m', `pod(sync): rebase onto Orca ${state.tag}`, '-m', body])
  rmSync(gitPath(STATE_FILE), { force: true })
  Object.assign(report, { status: 'done', movedWorkflows: moved, resolved: state.resolved })
  console.log(`\nRebased Pod onto ${state.tag} on branch ${state.branch}.`)
  for (const entry of state.resolved) {
    console.log(
      `  resolved by rule in ${entry.commit.slice(0, 10)} ${entry.subject}: ${entry.files.join(', ')}`
    )
  }
  if (moved.length > 0) {
    console.log(`  moved upstream workflows aside: ${moved.join(', ')}`)
  }
}

function printStop(report) {
  const { commit, needsPerson, resolvedHere } = report
  const position = commit.number ? ` (commit ${commit.number} of ${commit.of})` : ''
  console.log(`\nStopped replaying ${commit.sha.slice(0, 10)} "${commit.subject}"${position}.`)
  console.log('Needs a person:')
  for (const { path, reason } of needsPerson) {
    console.log(`  ${path}: ${reason}`)
  }
  if (resolvedHere.length > 0) {
    console.log(`Resolved by rule and staged: ${resolvedHere.join(', ')}`)
  }
  console.log(
    'Resolve and `git add` the files above, then: node config/pod-sync-upstream.mjs --continue'
  )
  console.log('To give up: git rebase --abort')
}

function stopped(report, state, commit, needsPerson, resolvedHere = []) {
  Object.assign(report, {
    status: 'stopped',
    commit,
    needsPerson,
    resolvedHere,
    resolved: state.resolved
  })
  return 2
}

function drive(state, report, rebaseDone) {
  Object.assign(report, { tag: state.tag, base: state.base, branch: state.branch })
  let done = rebaseDone
  let lastStop = null
  while (!done && rebaseInProgress()) {
    const { commit, needsPerson, resolved } = resolveStop(state)
    if (needsPerson.length > 0) {
      return stopped(report, state, commit, needsPerson, resolved)
    }
    if (lastStop === commit.sha) {
      const reason = 'git rebase --continue failed without a conflict; see its output above'
      return stopped(report, state, commit, [{ path: '(none)', reason }], resolved)
    }
    if (!git(['diff', '--cached', '--name-only']).trim()) {
      const reason = 'the commit has no changes left; run `git rebase --skip` if that is right'
      return stopped(report, state, commit, [{ path: '(none)', reason }], resolved)
    }
    lastStop = commit.sha
    done = git(['rebase', '--continue'], { allowFailure: true, inherit: true }).status === 0
  }
  try {
    finish(state, report)
  } catch (error) {
    if (!(error instanceof Stop)) {
      throw error
    }
    const head = { sha: git(['rev-parse', 'HEAD']).trim(), subject: 'after the rebase' }
    const reason = `${error.message}; fix it, then run --continue again`
    return stopped(report, state, head, [{ path: '(finish)', reason }])
  }
  return 0
}

// Why read before parsing and before the chdir: a refused argument must still leave a
// report, at the path the caller meant.
function reportPathFrom(argv) {
  const value = argv[argv.indexOf('--report') + 1]
  return argv.includes('--report') && value && !value.startsWith('-') ? resolve(value) : null
}

function main() {
  const argv = process.argv.slice(2)
  const reportPath = reportPathFrom(argv)
  const report = { status: 'error' }
  let code = 1
  try {
    const options = parseArgs(argv)
    process.chdir(git(['rev-parse', '--show-toplevel']).trim())
    if (options.continue) {
      const state = loadState()
      const head = rebaseInProgress()
        ? readFileSync(join(gitPath('rebase-merge'), 'head-name'), 'utf8').trim()
        : git(['symbolic-ref', '-q', 'HEAD'], { allowFailure: true }).stdout.trim()
      if (head !== `refs/heads/${state.branch}`) {
        throw new Refusal(
          `the sync is for branch ${state.branch}, but ${head || 'a detached HEAD'} is checked out`
        )
      }
      const unmerged = gitLines(['diff', '--name-only', '--diff-filter=U'])
      if (unmerged.length > 0) {
        throw new Refusal(`still unresolved: ${unmerged.join(', ')}`)
      }
      const continued =
        !rebaseInProgress() ||
        git(['rebase', '--continue'], { allowFailure: true, inherit: true }).status === 0
      code = drive(state, report, continued)
    } else {
      const clean = start(options, report)
      code = drive(loadState(), report, clean)
    }
    if (code === 2) {
      printStop(report)
    }
  } catch (error) {
    report.error = error.message
    console.error(`pod-sync-upstream: ${error.message}`)
    if (!(error instanceof Refusal)) {
      console.error(error.stack)
    }
  }
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  process.exit(code)
}

main()
