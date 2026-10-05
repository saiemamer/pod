import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import type { DbtLineagePythonSource } from '../../../shared/ae/dbt-graph-types'
import { findOnPath } from './dbt-runner'

/**
 * Pod: which Python runs the sqlglot sidecar, and the copy of sqlglot it imports.
 * sqlglot (MIT, pure Python) ships in `resources/pod-sqlglot`, so any Python 3.9+
 * the person already has will do: the one in Settings, then the one that runs dbt,
 * then python3 on PATH. See resources/pod-sqlglot/README.md for updating the copy.
 */
export type SqlglotPythonCandidate = { path: string; source: DbtLineagePythonSource }

export type SqlglotBundle = {
  /** Put first on PYTHONPATH; holds the `sqlglot` package. */
  dir: string
  /** Bytecode goes here, never into the signed app bundle. */
  pycacheDir: string
}

const PYTHON_NAME = /^python(\d+(\.\d+)*)?(\.exe)?$/i

/** The packaged app unpacks `resources/**` beside app.asar; `pnpm dev` reads the checkout. */
export function findSqlglotBundle(appPath: string, userData: string): SqlglotBundle | null {
  const root = appPath.replace(/app\.asar$/, 'app.asar.unpacked')
  const dir = join(root, 'resources', 'pod-sqlglot')
  return existsSync(join(dir, 'sqlglot', '__init__.py'))
    ? { dir, pycacheDir: join(userData, 'sqlglot-pycache') }
    : null
}

/** The child env: the bundled copy wins over any sqlglot the interpreter has of its own. */
export function sqlglotProcessEnv(
  env: NodeJS.ProcessEnv,
  bundle: SqlglotBundle | null
): NodeJS.ProcessEnv {
  if (!bundle) {
    return env
  }
  const existing = env.PYTHONPATH?.trim()
  return {
    ...env,
    PYTHONPATH: existing ? `${bundle.dir}${delimiter}${existing}` : bundle.dir,
    PYTHONPYCACHEPREFIX: bundle.pycacheDir
  }
}

function readHead(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, length).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * The interpreter named by a pip-installed script: `#!/venv/bin/python3.12`,
 * `#!/usr/bin/env python3`, or pip's `#!/bin/sh` + `'''exec' "/long path/python"` form
 * for paths with spaces or past the shebang limit. Null for shims, Fusion and .exe launchers.
 */
export function pythonFromShebang(head: string, env: NodeJS.ProcessEnv): string | null {
  const lines = head.split(/\r?\n/)
  if (!lines[0]?.startsWith('#!')) {
    return null
  }
  const exec = /^'''exec' (?:"([^"]+)"|(\S+))/.exec(lines[1] ?? '')
  if (exec) {
    const path = exec[1] ?? exec[2]
    return PYTHON_NAME.test(basename(path)) ? findOnPath(path, undefined) : null
  }
  const words = lines[0].slice(2).trim().split(/\s+/)
  const program =
    basename(words[0] ?? '') === 'env' ? words.slice(1).find((w) => !w.startsWith('-')) : words[0]
  if (!program || !PYTHON_NAME.test(basename(program))) {
    return null
  }
  return findOnPath(program, env.PATH)
}

/** The Python that runs this dbt: its shebang, else a python beside it (venvs, pyenv, Windows Scripts). */
export function pythonForDbt(dbtPath: string, env: NodeJS.ProcessEnv): string[] {
  let real: string
  try {
    real = realpathSync(dbtPath)
  } catch {
    return []
  }
  const found: string[] = []
  try {
    const fromShebang = pythonFromShebang(readHead(real), env)
    if (fromShebang) {
      found.push(fromShebang)
    }
  } catch {
    // Unreadable: fall through to the neighbours.
  }
  const dir = dirname(real)
  const neighbours =
    process.platform === 'win32'
      ? [join(dir, 'python.exe'), join(dirname(dir), 'python.exe')]
      : [join(dir, 'python3'), join(dir, 'python')]
  for (const candidate of neighbours) {
    const ok = findOnPath(candidate, undefined)
    if (ok) {
      found.push(ok)
    }
  }
  return found
}

export function sqlglotPythonCandidates(
  override: string | undefined,
  dbtBinary: string | null | undefined,
  env: NodeJS.ProcessEnv
): SqlglotPythonCandidate[] {
  const candidates: SqlglotPythonCandidate[] = []
  const explicit = override?.trim()
  if (explicit) {
    candidates.push({ path: explicit, source: 'settings' })
  }
  for (const path of dbtBinary ? pythonForDbt(dbtBinary, env) : []) {
    candidates.push({ path, source: 'dbt' })
  }
  for (const name of ['python3', 'python']) {
    const path = findOnPath(name, env.PATH)
    if (path) {
      candidates.push({ path, source: 'path' })
    }
  }
  const seen = new Set<string>()
  return candidates.filter((c) => {
    if (seen.has(c.path)) {
      return false
    }
    seen.add(c.path)
    return true
  })
}
