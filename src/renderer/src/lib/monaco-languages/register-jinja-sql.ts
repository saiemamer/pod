import type * as Monaco from 'monaco-editor'
import type { IRawGrammar } from 'vscode-textmate'
import { registerTextMateLanguage } from './textmate-language-registration'

type MonacoModule = typeof Monaco

/**
 * Pod: dbt models are SQL with Jinja in it. The `jinja-sql` grammar includes a plain
 * SQL grammar, so every .sql file uses it: outside dbt the Jinja rules never match and
 * the file reads as SQL, inside dbt `{{ ref() }}` and `{% if %}` get their own colours.
 */
export const JINJA_SQL_LANGUAGE_ID = 'jinja-sql'
export const JINJA_SQL_TEXTMATE_SCOPE = 'source.sql.jinja'
const JINJA_TEXTMATE_SCOPE = 'source.jinja'
const SQL_TEXTMATE_SCOPE = 'source.sql'

export const jinjaSqlLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '--',
    blockComment: ['/*', '*/']
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string'] }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '`', close: '`' }
  ],
  folding: {
    markers: {
      start: /\{%-?\s*(if|for|macro|block|filter|raw|set)\b/,
      end: /\{%-?\s*end(if|for|macro|block|filter|raw|set)\b/
    }
  }
}

/**
 * Why three grammars: jinja-sql only includes `source.jinja` and `source.sql`, and the
 * TextMate registry asks this loader for every included scope. All three are MIT; see
 * textmate-grammars/jinja-LICENSE.txt (samuelcolvin/jinjahtml-vscode) and
 * sql-LICENSE.txt (microsoft/vscode-mssql, via microsoft/vscode).
 */
export async function loadJinjaSqlTextMateGrammar(scopeName: string): Promise<IRawGrammar | null> {
  switch (scopeName) {
    case JINJA_SQL_TEXTMATE_SCOPE:
      return (await import('./textmate-grammars/jinja-sql.tmLanguage.json'))
        .default as unknown as IRawGrammar
    case JINJA_TEXTMATE_SCOPE:
      return (await import('./textmate-grammars/jinja.tmLanguage.json'))
        .default as unknown as IRawGrammar
    case SQL_TEXTMATE_SCOPE:
      return (await import('./textmate-grammars/sql.tmLanguage.json'))
        .default as unknown as IRawGrammar
    default:
      return null
  }
}

export function registerJinjaSqlLanguage(monaco: MonacoModule): void {
  registerTextMateLanguage(monaco, {
    language: {
      id: JINJA_SQL_LANGUAGE_ID,
      extensions: ['.sql'],
      aliases: ['Jinja SQL', 'jinja-sql', 'dbt SQL']
    },
    configuration: jinjaSqlLanguageConfiguration,
    scopeName: JINJA_SQL_TEXTMATE_SCOPE,
    loadGrammar: loadJinjaSqlTextMateGrammar
  })
}
