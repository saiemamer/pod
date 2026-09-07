import { describe, expect, it } from 'vitest'
import { loadDbtEnvFiles, parseDotEnv } from './dbt-env-file'

describe('parseDotEnv', () => {
  it('reads assignments, quotes, export prefixes and inline comments', () => {
    expect(
      parseDotEnv(
        [
          '# comment',
          '',
          'PERSONAL_DATASET=personal_saiem',
          'export PERSONAL_EXECUTION_PROJECT=mol-data-analytics-dev # costs here',
          'QUOTED="a b\\nc"',
          "SINGLE='keep # this'",
          'EMPTY=',
          '1BAD=nope',
          'not an assignment'
        ].join('\n')
      )
    ).toEqual({
      PERSONAL_DATASET: 'personal_saiem',
      PERSONAL_EXECUTION_PROJECT: 'mol-data-analytics-dev',
      QUOTED: 'a b\nc',
      SINGLE: 'keep # this',
      EMPTY: ''
    })
  })
})

describe('loadDbtEnvFiles', () => {
  it('applies files from the repo root down, .local over .env, and the explicit file last', () => {
    const files: Record<string, string> = {
      '/repo/.env': 'A=root\nB=root\nC=root',
      '/repo/.env.local': 'B=root-local',
      '/repo/dbt/.env': 'C=project',
      '/tmp/explicit.env': 'A=explicit'
    }
    const result = loadDbtEnvFiles({
      repoRoot: '/repo',
      projectDir: '/repo/dbt',
      envFile: '/tmp/explicit.env',
      readFile: (path) => files[path] ?? null
    })
    expect(result.values).toEqual({ A: 'explicit', B: 'root-local', C: 'project' })
    expect(result.files).toEqual([
      '/repo/.env',
      '/repo/.env.local',
      '/repo/dbt/.env',
      '/tmp/explicit.env'
    ])
  })

  it('reads only the project directory when the repo root is unknown or elsewhere', () => {
    const reads: string[] = []
    const result = loadDbtEnvFiles({
      projectDir: '/proj',
      repoRoot: '/other',
      envFile: 'custom.env',
      readFile: (path) => {
        reads.push(path)
        return null
      }
    })
    expect(result).toEqual({ values: {}, files: [] })
    expect(reads).toEqual(['/proj/.env', '/proj/.env.local', '/proj/custom.env'])
  })
})
