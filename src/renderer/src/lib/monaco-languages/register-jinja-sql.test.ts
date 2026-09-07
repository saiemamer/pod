import { describe, expect, it, vi } from 'vitest'
import { detectLanguage } from '../language-detect'
import {
  JINJA_SQL_LANGUAGE_ID,
  JINJA_SQL_TEXTMATE_SCOPE,
  jinjaSqlLanguageConfiguration,
  loadJinjaSqlTextMateGrammar,
  registerJinjaSqlLanguage
} from './register-jinja-sql'

function createMonacoMock() {
  return {
    languages: {
      getLanguages: vi.fn(() => []),
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      registerTokensProviderFactory: vi.fn()
    }
  }
}

describe('registerJinjaSqlLanguage', () => {
  it('registers the TextMate-backed jinja-sql language for .sql files', () => {
    const monaco = createMonacoMock()

    registerJinjaSqlLanguage(monaco as never)

    expect(monaco.languages.register).toHaveBeenCalledWith({
      id: JINJA_SQL_LANGUAGE_ID,
      extensions: ['.sql'],
      aliases: ['Jinja SQL', 'jinja-sql', 'dbt SQL']
    })
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith(
      JINJA_SQL_LANGUAGE_ID,
      jinjaSqlLanguageConfiguration
    )
    expect(monaco.languages.registerTokensProviderFactory).toHaveBeenCalledWith(
      JINJA_SQL_LANGUAGE_ID,
      expect.objectContaining({ create: expect.any(Function) })
    )
  })

  it('routes .sql files to jinja-sql so dbt models get Jinja colouring', () => {
    expect(detectLanguage('models/marts/orders.sql')).toBe(JINJA_SQL_LANGUAGE_ID)
    expect(detectLanguage('C:\\repo\\analysis\\REPORT.SQL')).toBe(JINJA_SQL_LANGUAGE_ID)
  })
})

describe('loadJinjaSqlTextMateGrammar', () => {
  it('serves the top-level grammar and both grammars it includes', async () => {
    const top = await loadJinjaSqlTextMateGrammar(JINJA_SQL_TEXTMATE_SCOPE)
    expect(top).toMatchObject({ name: 'jinja-sql', scopeName: 'source.sql.jinja' })
    const includes = (top as { patterns: { include: string }[] }).patterns.map(
      (pattern) => pattern.include
    )
    expect(includes).toEqual(['source.jinja', 'source.sql'])
    for (const scope of includes) {
      await expect(loadJinjaSqlTextMateGrammar(scope)).resolves.toMatchObject({
        scopeName: scope
      })
    }
  })

  it('ignores unrelated TextMate scopes', async () => {
    await expect(loadJinjaSqlTextMateGrammar('source.python')).resolves.toBeNull()
  })
})
