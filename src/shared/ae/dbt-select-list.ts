/**
 * Pod: enough SQL and Jinja reading to name a model's output columns when neither the
 * catalog nor the manifest lists them, and to hand a model's SQL to sqlglot before
 * `dbt compile` has run. Not a parser: it strips Jinja, finds the final SELECT and
 * splits its list on top-level commas.
 */
export type DbtRelationRef =
  | { kind: 'ref'; name: string; packageName?: string }
  | { kind: 'source'; sourceName: string; tableName: string }

export type DbtStrippedSql = {
  sql: string
  refs: DbtRelationRef[]
}

const REF_RE =
  /\{\{-?\s*ref\(\s*(['"])([^'"]+)\1\s*(?:,\s*(['"])([^'"]+)\3\s*)?(?:,[^)]*)?\)\s*-?\}\}/g
const SOURCE_RE = /\{\{-?\s*source\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*\)\s*-?\}\}/g

/**
 * Identifier the stripped SQL uses for a ref or source, and that the schema map is keyed
 * by. One segment each: sqlglot wants every table in a schema at the same depth.
 */
export function dbtRelationIdentifier(ref: DbtRelationRef): string {
  return ref.kind === 'ref' ? ref.name : `${ref.sourceName}__${ref.tableName}`
}

/**
 * Replace `ref()` and `source()` with plain identifiers, drop config, comments and
 * statements, and turn any other expression into NULL so the SQL still parses.
 */
export function stripDbtJinja(text: string): DbtStrippedSql {
  const refs: DbtRelationRef[] = []
  const seen = new Set<string>()
  const push = (ref: DbtRelationRef): string => {
    const id = dbtRelationIdentifier(ref)
    if (!seen.has(id)) {
      seen.add(id)
      refs.push(ref)
    }
    return id
  }
  let sql = text.replace(/\{#[\s\S]*?#\}/g, ' ')
  sql = sql.replace(REF_RE, (_match, _q1, first: string, _q3, second?: string) =>
    second
      ? push({ kind: 'ref', packageName: first, name: second })
      : push({ kind: 'ref', name: first })
  )
  sql = sql.replace(SOURCE_RE, (_match, _q1, sourceName: string, _q3, tableName: string) =>
    push({ kind: 'source', sourceName, tableName })
  )
  sql = sql.replace(/\{\{-?\s*config\([\s\S]*?\)\s*-?\}\}/g, ' ')
  sql = sql.replace(/\{%[\s\S]*?%\}/g, ' ')
  sql = sql.replace(/\{\{[\s\S]*?\}\}/g, 'NULL')
  return { sql: sql.replace(/[ \t]{2,}/g, ' ').trim(), refs }
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

type Scanner = { depth: number; quote: string | null }

/** Advances quote and paren state for one character; returns true when the character is structural. */
function scan(state: Scanner, ch: string): boolean {
  if (state.quote) {
    if (ch === state.quote) {
      state.quote = null
    }
    return false
  }
  if (ch === "'" || ch === '"' || ch === '`') {
    state.quote = ch
    return false
  }
  if (ch === '(') {
    state.depth += 1
    return false
  }
  if (ch === ')') {
    state.depth -= 1
    return false
  }
  return true
}

/** Splits on commas that sit outside parentheses and quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  const state: Scanner = { depth: 0, quote: null }
  let current = ''
  for (const ch of text) {
    if (scan(state, ch) && ch === ',' && state.depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) {
    parts.push(current)
  }
  return parts
}

function wordAt(sql: string, index: number, word: string): boolean {
  return (
    sql.slice(index, index + word.length).toLowerCase() === word &&
    !/\w/.test(sql[index - 1] ?? ' ') &&
    !/\w/.test(sql[index + word.length] ?? ' ')
  )
}

/** Index of the last top-level SELECT keyword, so CTE bodies are skipped. */
function findFinalSelect(sql: string): number {
  const state: Scanner = { depth: 0, quote: null }
  let last = -1
  for (let i = 0; i < sql.length; i += 1) {
    if (scan(state, sql[i]) && state.depth === 0 && wordAt(sql, i, 'select')) {
      last = i
    }
  }
  return last
}

/** Where the select list ends: the top-level FROM, or the end of the statement. */
function selectListEnd(sql: string, start: number): number {
  const state: Scanner = { depth: 0, quote: null }
  for (let i = start; i < sql.length; i += 1) {
    scan(state, sql[i])
    if (state.depth < 0) {
      return i
    }
    if (state.depth === 0 && !state.quote && wordAt(sql, i, 'from')) {
      return i
    }
  }
  return sql.length
}

function unquote(identifier: string): string {
  return identifier.replace(/^[`"[]|[`"\]]$/g, '')
}

const OPERATOR_TAIL = /(?:\b(?:case|when|then|else|and|or|not|is|in|like|between)|[+\-*/=<>|])\s*$/i

/** The name an expression lands under: its alias, else its last identifier segment. */
export function selectEntryName(entry: string): string | null {
  const text = entry.trim().replace(/\s+/g, ' ')
  if (!text || text === '*' || text.endsWith('.*') || /^except\s*\(/i.test(text)) {
    return null
  }
  const alias = /\s+as\s+([`"[]?[\w$]+[`"\]]?)\s*$/i.exec(text)
  if (alias) {
    return unquote(alias[1])
  }
  // Why: `expr name` without AS is legal; take it only when the tail is a bare word
  // that does not close a call or a literal.
  const implicit = /^(.*?\S)\s+([`"[]?[A-Za-z_][\w$]*[`"\]]?)$/.exec(text)
  if (
    implicit &&
    !/['`"\d]$/.test(implicit[1]) &&
    !/^(?:as|from|end)$/i.test(implicit[2]) &&
    !OPERATOR_TAIL.test(implicit[1])
  ) {
    return unquote(implicit[2])
  }
  const column = /(?:^|\.)([`"[]?[A-Za-z_][\w$]*[`"\]]?)$/.exec(text)
  return column && !/\(/.test(text) ? unquote(column[1]) : null
}

export type DbtParsedSelectList = {
  columns: string[]
  /** True when a `*` in the final select means the list is incomplete. */
  hasStar: boolean
}

/** Names of the columns the final SELECT produces; `*` sets hasStar and is skipped. */
export function parseDbtSelectList(sql: string): DbtParsedSelectList {
  const clean = stripComments(sql)
  const start = findFinalSelect(clean)
  if (start < 0) {
    return { columns: [], hasStar: false }
  }
  let body = clean.slice(start + 6, selectListEnd(clean, start + 6))
  body = body.replace(/^\s*(?:distinct|all)\b/i, '')
  const columns: string[] = []
  let hasStar = false
  for (const entry of splitTopLevel(body)) {
    const trimmed = entry.trim()
    if (trimmed === '*' || trimmed.endsWith('.*') || /^\*\s+except/i.test(trimmed)) {
      hasStar = true
      continue
    }
    const name = selectEntryName(trimmed)
    if (name && !columns.includes(name)) {
      columns.push(name)
    }
  }
  return { columns, hasStar }
}
