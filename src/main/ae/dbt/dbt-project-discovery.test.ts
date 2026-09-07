import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverDbtProject,
  findDbtProjectFile,
  isWithin,
  readDbtProject
} from './dbt-project-discovery'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pod-dbt-discovery-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

describe('findDbtProjectFile', () => {
  it('walks up from a model file to the nearest dbt_project.yml', () => {
    const repo = tempDir()
    write(join(repo, 'dbt_project.yml'), 'name: repo\n')
    write(join(repo, 'models', 'marts', 'orders.sql'), 'select 1')
    expect(findDbtProjectFile(join(repo, 'models', 'marts', 'orders.sql'))).toBe(
      join(repo, 'dbt_project.yml')
    )
  })

  it('prefers the nearest project when projects nest and stops at the worktree root', () => {
    const repo = tempDir()
    write(join(repo, 'dbt_project.yml'), 'name: outer\n')
    write(join(repo, 'packages', 'inner', 'dbt_project.yml'), 'name: inner\n')
    write(join(repo, 'packages', 'inner', 'models', 'a.sql'), 'select 1')
    expect(findDbtProjectFile(join(repo, 'packages', 'inner', 'models', 'a.sql'))).toBe(
      join(repo, 'packages', 'inner', 'dbt_project.yml')
    )
    const above = tempDir()
    write(join(above, 'dbt_project.yml'), 'name: above\n')
    const worktree = join(above, 'worktree')
    mkdirSync(join(worktree, 'models'), { recursive: true })
    expect(findDbtProjectFile(join(worktree, 'models'), worktree)).toBeNull()
  })

  it('looks one level below the top directory when the project sits in a subfolder', () => {
    const repo = tempDir()
    write(join(repo, 'dbt', 'dbt_project.yml'), 'name: nested\n')
    write(join(repo, 'README.md'), '# repo')
    expect(findDbtProjectFile(repo)).toBe(join(repo, 'dbt', 'dbt_project.yml'))
    expect(findDbtProjectFile(join(repo, 'README.md'), repo)).toBe(
      join(repo, 'dbt', 'dbt_project.yml')
    )
  })
})

describe('discoverDbtProject', () => {
  it('honours a project directory override, absolute or relative to the root', () => {
    const repo = tempDir()
    write(join(repo, 'analytics', 'dbt_project.yml'), 'name: analytics\n')
    write(join(repo, 'other', 'dbt_project.yml'), 'name: other\n')
    expect(
      discoverDbtProject({ startPath: repo, stopAt: repo, projectDir: 'analytics' })?.name
    ).toBe('analytics')
    expect(discoverDbtProject({ startPath: repo, projectDir: join(repo, 'other') })?.name).toBe(
      'other'
    )
    // Why: an override that points nowhere falls back to discovery instead of failing.
    expect(discoverDbtProject({ startPath: repo, projectDir: 'missing' })?.name).toBe('analytics')
  })

  it('returns null when there is no project', () => {
    const plain = tempDir()
    expect(discoverDbtProject({ startPath: plain })).toBeNull()
  })
})

describe('readDbtProject', () => {
  it('reads the keys Pod needs and defaults the rest', () => {
    const repo = tempDir()
    write(
      join(repo, 'dbt_project.yml'),
      [
        "name: 'dbt_analytics'",
        "profile: 'dbt_analytics'",
        'model-paths: ["dbt/models"]',
        'macro-paths: dbt/macros',
        'target-path: "build"',
        ''
      ].join('\n')
    )
    expect(readDbtProject(join(repo, 'dbt_project.yml'))).toEqual({
      projectDir: repo,
      projectFile: join(repo, 'dbt_project.yml'),
      name: 'dbt_analytics',
      profile: 'dbt_analytics',
      modelPaths: ['dbt/models'],
      macroPaths: ['dbt/macros'],
      targetPath: 'build'
    })
  })

  it('falls back to the folder name and dbt defaults when the YAML is unreadable', () => {
    const repo = tempDir()
    write(join(repo, 'dbt_project.yml'), 'name: [unterminated\n')
    const project = readDbtProject(join(repo, 'dbt_project.yml'))
    expect(project.name).toBe(join(repo).split('/').at(-1))
    expect(project.modelPaths).toEqual(['models'])
    expect(project.targetPath).toBe('target')
  })
})

describe('isWithin', () => {
  it('treats the root itself and its descendants as inside, siblings as outside', () => {
    expect(isWithin('/a/b', '/a')).toBe(true)
    expect(isWithin('/a', '/a')).toBe(true)
    expect(isWithin('/ab', '/a')).toBe(false)
  })
})
