import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { resolveRunnableDbtBinary } from './dbt-runnable-binary'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function stub(dir: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'dbt')
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

describe('resolveRunnableDbtBinary', () => {
  it('with an empty settings field skips a broken first dbt, uses the next, and looks once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-dbt-runnable-'))
    roots.push(root)
    // The work laptop: a shim whose Python was deleted, the working dbt behind it.
    stub(join(root, 'shims'), '#!/nonexistent/python3\n')
    const working = stub(
      join(root, 'pyenv'),
      '#!/bin/sh\nprintf "Core:\\n  - installed: 1.9.4\\n"\n'
    )
    const env = { PATH: [join(root, 'shims'), join(root, 'pyenv'), '/bin'].join(delimiter) }
    const run = vi.fn(runProcess)

    const first = await resolveRunnableDbtBinary('', [join(root, 'repo')], env, { run, home: root })
    const again = await resolveRunnableDbtBinary(undefined, [join(root, 'repo')], env, {
      run,
      home: root
    })

    expect(first).toEqual({ path: working, source: 'path' })
    expect(again).toEqual(first)
    expect(run).toHaveBeenCalledTimes(2)
    expect(await resolveRunnableDbtBinary(' /opt/dbt ', [], env)).toEqual({
      path: '/opt/dbt',
      source: 'settings'
    })
  })
})
