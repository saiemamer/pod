import { describe, expect, it } from 'vitest'
import { dbtLspFileUri, dbtLspUriToPath } from './dbt-lsp-types'

describe('file URIs for the language server', () => {
  it('round-trips POSIX paths with spaces and unicode', () => {
    const path = '/Users/saiem amer/Projets/dbt-analytics/models/ünïcode.sql'
    const uri = dbtLspFileUri(path)
    expect(uri.startsWith('file:///Users/saiem%20amer/')).toBe(true)
    expect(dbtLspUriToPath(uri)).toBe(path)
  })

  it('accepts Windows-style URIs and rejects other schemes', () => {
    expect(dbtLspUriToPath('file:///C:/repo/models/x.sql')).toBe('C:/repo/models/x.sql')
    expect(dbtLspUriToPath('inmemory://model/1')).toBeNull()
    expect(dbtLspUriToPath('file://host/share')).toBeNull()
  })
})
