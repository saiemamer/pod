import { describe, expect, it } from 'vitest'
import { readDbtCatalogSkips } from './dbt-catalog-output'

describe('readDbtCatalogSkips', () => {
  it('names the dataset when BigQuery refuses a table inside it', () => {
    // The shape dbt-bigquery wrote into catalog.json on a real project (names changed).
    const denied = (dataset: string): string =>
      `Database Error\n  Access Denied: Table some-project:${dataset}.__TABLES__: User does not have permission to query table some-project:${dataset}.__TABLES__, or perhaps it does not exist.`
    const catalog = JSON.stringify({
      nodes: {},
      errors: [
        denied('finance'),
        denied('hr'),
        'Database Error\n  Access Denied: Table some-project:hr.INFORMATION_SCHEMA.COLUMNS: User does not have permission to query table some-project:hr.INFORMATION_SCHEMA.COLUMNS.'
      ]
    })
    const skips = readDbtCatalogSkips(catalog)
    expect(skips?.map((skip) => skip.dataset)).toEqual(['some-project:finance', 'some-project:hr'])
    expect(skips?.[0].message).toMatch(/^Access Denied: Table some-project:finance\.__TABLES__/)
  })
})
