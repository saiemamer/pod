import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DbtProjectInfo } from './dbt-project-discovery'
import { findDbtModelFiles, resolveDbtRef } from './dbt-ref-resolve'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-ref-'))
  for (const file of [
    'models/marts/orders.sql',
    'models/staging/stg_orders.sql',
    'models/legacy/Orders.sql',
    'models/target/orders.sql',
    'analyses/orders.sql',
    'models/marts/orders.yml'
  ]) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), 'select 1')
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function project(): DbtProjectInfo {
  return {
    projectDir: root,
    projectFile: join(root, 'dbt_project.yml'),
    name: 'demo',
    modelPaths: ['models'],
    macroPaths: ['macros'],
    targetPath: 'target'
  }
}

describe('ref() resolution by file scan', () => {
  it('finds every model file with that name under the model paths, case-insensitively', () => {
    expect(findDbtModelFiles(project(), 'orders')).toEqual([
      join(root, 'models/legacy/Orders.sql'),
      join(root, 'models/marts/orders.sql')
    ])
    expect(findDbtModelFiles(project(), 'stg_orders')).toEqual([
      join(root, 'models/staging/stg_orders.sql')
    ])
    expect(findDbtModelFiles(project(), 'missing')).toEqual([])
  })

  it('prefers the manifest path when given and lists the rest as alternatives', () => {
    const preferred = join(root, 'models/marts/orders.sql')
    expect(resolveDbtRef(project(), 'orders', preferred)).toEqual({
      name: 'orders',
      file: preferred,
      alternatives: [join(root, 'models/legacy/Orders.sql')]
    })
    expect(resolveDbtRef(project(), ' stg_orders ')).toEqual({
      name: 'stg_orders',
      file: join(root, 'models/staging/stg_orders.sql'),
      alternatives: []
    })
    expect(resolveDbtRef(project(), 'nothing').file).toBeNull()
  })
})
