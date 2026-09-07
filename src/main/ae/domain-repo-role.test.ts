import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAeRepoRole } from './domain-repo-role'

const roots: string[] = []
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pod-role-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('detectAeRepoRole', () => {
  it('finds dbt_project.yml at the root or one level down', () => {
    const root = repo()
    writeFileSync(join(root, 'dbt_project.yml'), 'name: x\n')
    expect(detectAeRepoRole(root)).toBe('dbt')
    const nested = repo()
    mkdirSync(join(nested, 'dbt'))
    writeFileSync(join(nested, 'dbt', 'dbt_project.yml'), 'name: x\n')
    expect(detectAeRepoRole(nested)).toBe('dbt')
  })

  it('recognises Omni model repos by model.yaml or topic files', () => {
    const withModel = repo()
    writeFileSync(join(withModel, 'model.yaml'), 'connection: bq\n')
    expect(detectAeRepoRole(withModel)).toBe('omni')
    const withTopics = repo()
    mkdirSync(join(withTopics, 'topics'))
    writeFileSync(join(withTopics, 'topics', 'orders.topic.yaml'), 'base_view: orders\n')
    expect(detectAeRepoRole(withTopics)).toBe('omni')
    // Why two levels: omni-analytics keeps its model under omni/<model name>/.
    const nested = repo()
    mkdirSync(join(nested, 'omni', 'mol-analytics'), { recursive: true })
    writeFileSync(join(nested, 'omni', 'mol-analytics', 'model.yaml'), 'connection: bq\n')
    expect(detectAeRepoRole(nested)).toBe('omni')
  })

  it('falls back to other', () => {
    const plain = repo()
    writeFileSync(join(plain, 'README.md'), '# infra\n')
    expect(detectAeRepoRole(plain)).toBe('other')
    expect(detectAeRepoRole(join(plain, 'missing'))).toBe('other')
  })
})
