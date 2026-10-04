import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { detectAeSetup } from './ae-setup-detect'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pod-setup-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function stub(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

const DBT_CORE = '#!/bin/sh\nprintf "Core:\\n  - installed: 1.9.4\\n  - latest:    1.9.4\\n"\n'
const OMNI = '#!/bin/sh\necho "omni version 0.6.2"\n'

function dbtRepo(target: string): string {
  const repo = tempDir()
  writeFileSync(join(repo, 'dbt_project.yml'), 'name: analytics\nprofile: mollie\n')
  writeFileSync(
    join(repo, 'profiles.yml'),
    [
      'mollie:',
      `  target: ${target}`,
      '  outputs:',
      '    saiem_dev: {type: bigquery, method: service-account, keyfile: /secret/keyfile-a.json}',
      '    dev: {type: bigquery, method: oauth, project: secret-project-b}',
      '    prod: {type: bigquery, method: service-account, keyfile: /secret/keyfile-c.json}',
      '    sqlfluff: {type: bigquery, password: hunter2-secret}',
      ''
    ].join('\n')
  )
  return repo
}

describe('detectAeSetup', () => {
  it('skips a broken dbt shim, reads the root profiles.yml and keeps credentials out', async () => {
    const home = tempDir()
    const bin = tempDir()
    const broken = stub(join(bin, 'shims'), 'dbt', '#!/nonexistent/python3\n')
    const working = stub(join(bin, 'pyenv'), 'dbt', DBT_CORE)
    stub(join(bin, 'pyenv'), 'omni', OMNI)
    const repo = dbtRepo('saiem_dev')

    const detection = await detectAeSetup(
      { dbtRepoPath: repo },
      {
        run: runProcess,
        env: { PATH: [join(bin, 'shims'), join(bin, 'pyenv'), '/bin', '/usr/bin'].join(delimiter) },
        home
      }
    )

    expect(detection.dbt.binary).toBe(working)
    expect(detection.dbt).toMatchObject({ distribution: 'core', version: '1.9.4' })
    expect(detection.dbt.candidates[0]).toMatchObject({ path: broken, ok: false })
    expect(detection.profiles).toEqual({
      dir: repo,
      targets: ['saiem_dev', 'dev', 'prod', 'sqlfluff'],
      defaultTarget: 'saiem_dev'
    })
    expect(detection.target).toBe('saiem_dev')
    const wire = JSON.stringify(detection)
    for (const secret of ['keyfile-a', 'secret-project-b', 'keyfile-c', 'hunter2']) {
      expect(wire).not.toContain(secret)
    }
  })

  it('does not choose a production default target and leaves the choice open', async () => {
    const home = tempDir()
    const detection = await detectAeSetup(
      { dbtRepoPath: dbtRepo('prod') },
      { run: runProcess, env: { PATH: '/bin:/usr/bin' }, home }
    )

    expect(detection.target).toBeNull()
    expect(detection.items.find((item) => item.key === 'target')).toMatchObject({
      status: 'choose',
      value: 'prod'
    })
  })

  it('counts a signed-in Omni CLI profile as sign-in without an API key', async () => {
    const home = tempDir()
    const bin = tempDir()
    stub(bin, 'omni', OMNI)
    mkdirSync(join(home, '.config', 'omni-cli'), { recursive: true })
    writeFileSync(join(home, '.config', 'omni-cli', 'config.json'), '{}')

    const detection = await detectAeSetup(
      { dbtRepoPath: dbtRepo('dev') },
      {
        run: runProcess,
        env: { PATH: `${bin}${delimiter}/bin`, OMNI_BASE_URL: 'https://acme.omniapp.co' },
        home
      }
    )

    expect(detection.omni).toEqual({
      binary: join(bin, 'omni'),
      version: '0.6.2',
      signIn: 'cli-profile',
      baseUrl: 'https://acme.omniapp.co'
    })
  })
})
