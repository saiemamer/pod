import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dbtCatalogCommands,
  DbtCatalogSessionLedger,
  parseDbtCatalogSummary,
  summarizeDbtCatalog
} from './dbt-catalog-refresh'
import type { DbtProjectInfo } from './dbt-project-discovery'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pod-catalog-'))
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

describe('catalog refresh', () => {
  it('runs parse then docs generate on Core and one compile on Fusion', () => {
    expect(dbtCatalogCommands('core')).toEqual([['parse'], ['docs', 'generate']])
    expect(dbtCatalogCommands('fusion')).toEqual([['compile', '--write-catalog']])
  })

  it('summarizes catalog.json without keeping columns in memory', () => {
    const text = JSON.stringify({
      metadata: { generated_at: '2026-09-07T10:00:00Z' },
      nodes: { 'model.demo.orders': { columns: { id: {} } } },
      sources: { 'source.demo.raw.orders': {} }
    })
    expect(parseDbtCatalogSummary('/p/target/catalog.json', text)).toEqual({
      file: '/p/target/catalog.json',
      exists: true,
      nodeCount: 2,
      generatedAt: '2026-09-07T10:00:00Z'
    })
    expect(parseDbtCatalogSummary('/p/c.json', 'not json')).toEqual({
      file: '/p/c.json',
      exists: true
    })
  })

  it('reads the file by mtime and reports a missing one', () => {
    expect(summarizeDbtCatalog(project())).toEqual({
      file: join(root, 'target', 'catalog.json'),
      exists: false
    })
    mkdirSync(join(root, 'target'))
    writeFileSync(join(root, 'target', 'catalog.json'), JSON.stringify({ nodes: { a: {} } }))
    expect(summarizeDbtCatalog(project()).nodeCount).toBe(1)
  })

  it('remembers refreshed projects for the session and tracks in-flight work', async () => {
    const ledger = new DbtCatalogSessionLedger()
    expect(ledger.has('/p')).toBe(false)
    let release: () => void = () => {}
    const work = new Promise<void>((resolve) => {
      release = resolve
    })
    const tracked = ledger.track('/p', work)
    expect(ledger.inFlight('/p')).toBe(work)
    release()
    await tracked
    expect(ledger.has('/p')).toBe(true)
    expect(ledger.inFlight('/p')).toBeUndefined()
    ledger.forget('/p')
    expect(ledger.has('/p')).toBe(false)
  })

  it('does not mark a project done when the run fails', async () => {
    const ledger = new DbtCatalogSessionLedger()
    await expect(ledger.track('/p', Promise.reject(new Error('dbt failed')))).rejects.toThrow()
    expect(ledger.has('/p')).toBe(false)
  })
})
