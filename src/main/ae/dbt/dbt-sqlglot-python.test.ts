import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import {
  findSqlglotBundle,
  pythonFromShebang,
  sqlglotPythonCandidates,
  sqlglotProcessEnv
} from './dbt-sqlglot-python'
import { DbtSqlglotSidecar } from './dbt-sqlglot-sidecar'

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-sqlglot-python-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function file(path: string, content: string, mode = 0o755): string {
  const full = join(root, path)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  chmodSync(full, mode)
  return full
}

/** Only what this test made; the lookup also scans fixed dirs such as /usr/local/bin. */
function ours(candidates: { path: string; source: string }[]): string[] {
  return candidates
    .filter((c) => c.source === 'settings' || c.path.startsWith(root))
    .map((c) => `${c.source}:${c.path.startsWith(root) ? c.path.slice(root.length) : c.path}`)
}

describe('pythonFromShebang', () => {
  it('reads a direct path, env, and pip’s long-path form', () => {
    const venvPython = file('venv/bin/python3.12', '')
    const spaced = file('my env/bin/python', '')
    const pathPython = file('path/python3', '')
    const env = { PATH: join(root, 'path') }
    expect(pythonFromShebang(`#!${venvPython}\nimport sys\n`, env)).toBe(venvPython)
    expect(pythonFromShebang('#!/usr/bin/env python3\n', env)).toBe(pathPython)
    expect(pythonFromShebang(`#!/bin/sh\n'''exec' "${spaced}" "$0" "$@"\n' '''\n`, env)).toBe(
      spaced
    )
  })

  it('ignores shims, binaries and non-Python interpreters', () => {
    expect(pythonFromShebang('#!/usr/bin/env bash\nexec pyenv exec dbt\n', {})).toBeNull()
    expect(pythonFromShebang('\u007fELF\u0002\u0001', {})).toBeNull()
    expect(pythonFromShebang('#!/usr/bin/node\n', {})).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('sqlglotPythonCandidates', () => {
  it('orders Settings, then the interpreter that runs dbt, then PATH, without repeats', () => {
    const dbtPython = file('venv/bin/python3.12', '#!/bin/sh\n')
    const dbt = file('venv/bin/dbt', `#!${dbtPython}\nfrom dbt.cli.main import cli\n`)
    file('path/python3', '#!/bin/sh\n')
    const env = { PATH: join(root, 'path') }
    expect(ours(sqlglotPythonCandidates('/custom/python', dbt, env))).toEqual([
      'settings:/custom/python',
      'dbt:/venv/bin/python3.12',
      'path:/path/python3'
    ])
    expect(ours(sqlglotPythonCandidates('  ', dbt, env))).toEqual([
      'dbt:/venv/bin/python3.12',
      'path:/path/python3'
    ])
  })

  it('falls back to a python beside a dbt shim, and skips a dbt with no interpreter', () => {
    file('shims/python3', '#!/bin/sh\n')
    const shim = file('shims/dbt', '#!/usr/bin/env bash\nexec pyenv exec dbt "$@"\n')
    const fusion = file('fusion/dbt', '\u007fELF\u0002\u0001')
    expect(ours(sqlglotPythonCandidates(undefined, shim, { PATH: '' }))).toEqual([
      'dbt:/shims/python3'
    ])
    expect(ours(sqlglotPythonCandidates(undefined, fusion, { PATH: '' }))).toEqual([])
    expect(ours(sqlglotPythonCandidates(undefined, join(root, 'missing/dbt'), {}))).toEqual([])
  })
})

describe('findSqlglotBundle', () => {
  it('finds the checkout copy in dev and the unpacked copy in a packaged app', () => {
    file('dev/resources/pod-sqlglot/sqlglot/__init__.py', '', 0o644)
    file('Pod.app/Resources/app.asar.unpacked/resources/pod-sqlglot/sqlglot/__init__.py', '', 0o644)
    expect(findSqlglotBundle(join(root, 'dev'), '/data')).toEqual({
      dir: join(root, 'dev/resources/pod-sqlglot'),
      pycacheDir: join('/data', 'sqlglot-pycache')
    })
    expect(findSqlglotBundle(join(root, 'Pod.app/Resources/app.asar'), '/data')?.dir).toBe(
      join(root, 'Pod.app/Resources/app.asar.unpacked/resources/pod-sqlglot')
    )
    expect(findSqlglotBundle(join(root, 'nowhere'), '/data')).toBeNull()
  })

  it('puts the bundle ahead of any PYTHONPATH the person has', () => {
    const bundle = { dir: '/b', pycacheDir: '/c' }
    expect(sqlglotProcessEnv({ PYTHONPATH: '/mine' }, bundle)).toMatchObject({
      PYTHONPATH: `/b${delimiter}/mine`,
      PYTHONPYCACHEPREFIX: '/c'
    })
    expect(sqlglotProcessEnv({}, bundle).PYTHONPATH).toBe('/b')
    expect(sqlglotProcessEnv({ A: '1' }, null)).toEqual({ A: '1' })
  })
})

describe.skipIf(process.platform === 'win32')('DbtSqlglotSidecar with stand-in pythons', () => {
  it('skips a Python that fails and imports sqlglot from the bundle with the next', async () => {
    const bundleDir = join(root, 'bundle')
    mkdirSync(bundleDir)
    const broken = file(
      'broken/python3',
      '#!/bin/sh\necho "dyld: Library not loaded" >&2\nexit 1\n'
    )
    // Answers the probe only when the bundled copy is first on PYTHONPATH, as real Python would.
    const dbtPython = file(
      'venv/bin/python3',
      `#!/bin/sh\ncase "$PYTHONPATH" in "${bundleDir}"*) printf 30.21.0;; *) echo "ModuleNotFoundError: No module named 'sqlglot'" >&2; exit 1;; esac\n`
    )
    const dbt = file('venv/bin/dbt', `#!${dbtPython}\n`)
    const sidecar = new DbtSqlglotSidecar({
      run: runProcess,
      bundle: { dir: bundleDir, pycacheDir: join(root, 'pycache') }
    })
    expect(await sidecar.status(broken, { PATH: '' }, dbt)).toEqual({
      engine: 'sqlglot',
      python: dbtPython,
      pythonSource: 'dbt',
      sqlglotVersion: '30.21.0'
    })
    const unbundled = new DbtSqlglotSidecar({
      run: runProcess,
      findPythons: () => [{ path: dbtPython, source: 'settings' }]
    })
    expect(await unbundled.status(undefined, {})).toMatchObject({
      engine: 'name-match',
      note: `${dbtPython} could not run sqlglot: ModuleNotFoundError: No module named 'sqlglot'`
    })
  })
})
