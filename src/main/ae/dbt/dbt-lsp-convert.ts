import type {
  DbtLspCompletionItem,
  DbtLspDiagnostic,
  DbtLspLocation,
  DbtLspPosition,
  DbtLspRange
} from '../../../shared/ae/dbt-lsp-types'

/**
 * Pod: LSP answers arrive as loosely typed JSON; these narrow them to the plain shapes
 * that cross IPC. Anything malformed is dropped rather than thrown.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null
}

function toPosition(value: unknown): DbtLspPosition | null {
  const record = asRecord(value)
  return typeof record.line === 'number' && typeof record.character === 'number'
    ? { line: record.line, character: record.character }
    : null
}

export function toRange(value: unknown): DbtLspRange | null {
  const record = asRecord(value)
  const start = toPosition(record.start)
  const end = toPosition(record.end)
  return start && end ? { start, end } : null
}

export function toLocation(value: unknown): DbtLspLocation | null {
  const record = asRecord(value)
  // Why both shapes: LocationLink spells the target as targetUri/targetRange.
  const uri = typeof record.uri === 'string' ? record.uri : record.targetUri
  const range = toRange(record.range ?? record.targetSelectionRange ?? record.targetRange)
  return typeof uri === 'string' && range ? { uri, range } : null
}

export function toCompletionItem(value: unknown): DbtLspCompletionItem | null {
  const record = asRecord(value)
  if (typeof record.label !== 'string') {
    return null
  }
  const item: DbtLspCompletionItem = { label: record.label }
  if (typeof record.kind === 'number') {
    item.kind = record.kind
  }
  for (const key of ['detail', 'insertText', 'sortText', 'filterText'] as const) {
    if (typeof record[key] === 'string' && record[key]) {
      item[key] = record[key] as string
    }
  }
  const documentation = hoverText(record.documentation)
  if (documentation) {
    item.documentation = documentation
  }
  return item
}

/** string | MarkedString | MarkupContent | (any of those)[] → one text. */
export function hoverText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (Array.isArray(value)) {
    return value.map(hoverText).filter(Boolean).join('\n\n')
  }
  const record = asRecord(value)
  if (typeof record.value === 'string') {
    const language = typeof record.language === 'string' ? record.language : null
    return language ? `\`\`\`${language}\n${record.value}\n\`\`\`` : record.value.trim()
  }
  return ''
}

export function toDiagnostics(value: unknown): DbtLspDiagnostic[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: DbtLspDiagnostic[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const range = toRange(record.range)
    if (!range || typeof record.message !== 'string') {
      continue
    }
    const diagnostic: DbtLspDiagnostic = { range, message: record.message }
    if (typeof record.severity === 'number') {
      diagnostic.severity = record.severity
    }
    if (typeof record.source === 'string') {
      diagnostic.source = record.source
    }
    if (typeof record.code === 'string' || typeof record.code === 'number') {
      diagnostic.code = record.code
    }
    out.push(diagnostic)
  }
  return out
}
