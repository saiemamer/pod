/**
 * Pod: what sits under the cursor in a dbt model, without a language server. `ref()`
 * and `source()` calls resolve to files (main scans the model paths); a CTE name jumps
 * to its `with x as (` inside the buffer. Columns are one-based, as Monaco reports them.
 */
export type DbtRefAtPosition =
  | { kind: 'ref'; name: string; packageName?: string; startColumn: number; endColumn: number }
  | { kind: 'source'; sourceName: string; name: string; startColumn: number; endColumn: number }
  | { kind: 'cte'; name: string; startColumn: number; endColumn: number }

const CALL_RE = /\b(ref|source)\s*\(\s*(['"])([^'"]+)\2(?:\s*,\s*(['"])([^'"]+)\4)?\s*\)/g
const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/g

/** The ref()/source() call whose string arguments span `column`, else the identifier there. */
export function findDbtRefAtPosition(lineText: string, column: number): DbtRefAtPosition | null {
  for (const match of lineText.matchAll(CALL_RE)) {
    const start = (match.index ?? 0) + 1
    const end = start + match[0].length
    if (column < start || column > end) {
      continue
    }
    const first = match[3]
    const second = match[5]
    if (match[1] === 'source') {
      return second
        ? { kind: 'source', sourceName: first, name: second, startColumn: start, endColumn: end }
        : null
    }
    return second
      ? { kind: 'ref', packageName: first, name: second, startColumn: start, endColumn: end }
      : { kind: 'ref', name: first, startColumn: start, endColumn: end }
  }
  for (const match of lineText.matchAll(WORD_RE)) {
    const start = (match.index ?? 0) + 1
    const end = start + match[0].length
    if (column >= start && column <= end) {
      return { kind: 'cte', name: match[0], startColumn: start, endColumn: end }
    }
  }
  return null
}

export type DbtCteDefinition = { lineNumber: number; column: number }

/** Where `name` is defined as a CTE (`with name as (` or `, name as (`), one-based. */
export function findDbtCteDefinition(text: string, name: string): DbtCteDefinition | null {
  const lines = text.split('\n')
  const re = new RegExp(`(?:^|\\bwith\\b|,)\\s*(${escapeRegExp(name)})\\s+as\\s*\\(`, 'i')
  for (let index = 0; index < lines.length; index += 1) {
    const match = re.exec(lines[index])
    if (match && match[1].toLowerCase() === name.toLowerCase()) {
      return { lineNumber: index + 1, column: match.index + match[0].indexOf(match[1]) + 1 }
    }
  }
  return null
}

/** All model names referenced through ref() in the text, unique, in order. */
export function listDbtRefs(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(CALL_RE)) {
    if (match[1] !== 'ref') {
      continue
    }
    const name = match[5] ?? match[3]
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
