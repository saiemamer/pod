import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findDbtProfilesDir } from './dbt-profiles-search'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pod-dbt-profiles-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function profiles(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'profiles.yml'), 'x: {}\n')
}

describe('findDbtProfilesDir', () => {
  it('ranks settings, then env, then project, repo and home, and otherwise defers to dbt', () => {
    const home = tempDir()
    const repo = tempDir()
    const project = join(repo, 'dbt')
    mkdirSync(project, { recursive: true })
    const base = { projectDir: project, repoRoot: repo, env: {}, home }

    expect(findDbtProfilesDir(base)).toEqual({ source: 'dbt' })

    profiles(join(home, '.dbt'))
    expect(findDbtProfilesDir(base)).toEqual({ dir: join(home, '.dbt'), source: 'home' })

    profiles(join(repo, 'local_profiles'))
    expect(findDbtProfilesDir(base)).toEqual({
      dir: join(repo, 'local_profiles'),
      source: 'repo'
    })

    profiles(join(project, '.dbt'))
    expect(findDbtProfilesDir(base)).toEqual({ dir: join(project, '.dbt'), source: 'project' })

    profiles(project)
    expect(findDbtProfilesDir(base)).toEqual({ dir: project, source: 'project' })

    expect(findDbtProfilesDir({ ...base, env: { DBT_PROFILES_DIR: '/from/env' } })).toEqual({
      dir: '/from/env',
      source: 'env'
    })
    expect(
      findDbtProfilesDir({ ...base, env: { DBT_PROFILES_DIR: '/from/env' }, override: '/set' })
    ).toEqual({ dir: '/set', source: 'settings' })
  })
})
