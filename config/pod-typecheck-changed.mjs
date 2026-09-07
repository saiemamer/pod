#!/usr/bin/env node
// Pod: typecheck only the files changed since a git ref, plus everything they import.
//
// Why: `pnpm typecheck:web` checks the whole renderer and needs more than the 2 GB heap
// Node gives itself on an 8 GB Mac once the incremental cache is cold; the CI runner has
// the memory, a laptop often does not. A slice built from `files` with `include: []`
// follows imports only, so a change to Pod's ae/ code checks in about half a minute.
//
//   node config/pod-typecheck-changed.mjs            # against HEAD (staged, unstaged, untracked)
//   node config/pod-typecheck-changed.mjs main       # against a ref
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const ref = process.argv[2] ?? 'HEAD'

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const changed = new Set([
  ...git(['diff', '--name-only', ref, '--']),
  ...git(['ls-files', '--others', '--exclude-standard'])
])

const PROJECTS = [
  {
    name: 'web',
    base: './tsconfig.web.json',
    match: (file) =>
      (file.startsWith('src/renderer/') ||
        file.startsWith('src/shared/') ||
        file.startsWith('src/preload/')) &&
      /\.(ts|tsx)$/.test(file),
    extra: ['../src/renderer/src/env.d.ts'],
    compilerOptions: {
      paths: { '@renderer/*': ['../src/renderer/src/*'], '@/*': ['../src/renderer/src/*'] }
    }
  },
  {
    name: 'node',
    base: './tsconfig.node.json',
    match: (file) =>
      (file.startsWith('src/main/') ||
        file.startsWith('src/shared/') ||
        file.startsWith('src/preload/') ||
        file.startsWith('src/cli/')) &&
      file.endsWith('.ts'),
    // Why: the global build identifiers live in src/types; without them telemetry/client.ts fails.
    extra: ['../src/types/build-constants.d.ts'],
    compilerOptions: {}
  }
]

let failed = false
for (const project of PROJECTS) {
  const files = [...changed].filter(project.match).map((file) => `../${file}`)
  if (files.length === 0) {
    console.log(`[${project.name}] nothing changed`)
    continue
  }
  const dir = mkdtempSync(join(tmpdir(), 'pod-tc-'))
  const configPath = join(root, 'config', `tsconfig.tc.pod-${project.name}.tmp.json`)
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        extends: project.base,
        include: [],
        files: [...project.extra, ...files],
        compilerOptions: { composite: false, incremental: false, ...project.compilerOptions }
      },
      null,
      2
    )
  )
  console.log(`[${project.name}] ${files.length} changed files`)
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', configPath],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=3072`.trim()
      }
    }
  )
  rmSync(configPath, { force: true })
  rmSync(dir, { recursive: true, force: true })
  if (result.status !== 0) {
    failed = true
  }
}
process.exit(failed ? 1 : 0)
