/**
 * Pod: turn `dbt show --output json` stdout into a table. dbt Core prints
 * `{"show": [row, ...]}`; dbt Fusion prints a bare array of rows. Either may be preceded
 * by log lines, so the parser tries the whole output first and then every line that
 * opens a JSON value.
 */
export type DbtShowTable = {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  source: 'core' | 'fusion'
}

export function parseDbtShowOutput(stdout: string): DbtShowTable | null {
  const text = stdout.trim()
  if (text.length === 0) {
    return null
  }
  const candidates = [text]
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimStart()
    if (line.startsWith('{') || line.startsWith('[')) {
      candidates.push(lines.slice(index).join('\n'))
    }
  }
  for (const candidate of candidates) {
    const table = tryParse(candidate)
    if (table) {
      return table
    }
  }
  return null
}

function tryParse(text: string): DbtShowTable | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(value)) {
    return tabulate(value, 'fusion')
  }
  if (isRecord(value) && Array.isArray(value.show)) {
    return tabulate(value.show, 'core')
  }
  return null
}

function tabulate(records: unknown[], source: DbtShowTable['source']): DbtShowTable | null {
  const columns: string[] = []
  const seen = new Set<string>()
  const objects: Record<string, unknown>[] = []
  for (const record of records) {
    if (!isRecord(record)) {
      return null
    }
    objects.push(record)
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  return {
    columns,
    rows: objects.map((record) => columns.map((column) => record[column] ?? null)),
    rowCount: objects.length,
    source
  }
}

/**
 * dbt's compile answer arrives as an INFO event. With `--log-format json` every stdout
 * line is an event, and the `CompiledNode` one carries the SQL as data, which is more
 * reliable than scraping the text banner.
 */
export function parseDbtCompiledFromJsonLogs(stdout: string): string | null {
  for (const line of stdout.split('\n').toReversed()) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(event) || !isRecord(event.data)) {
      continue
    }
    const info = isRecord(event.info) ? event.info : {}
    if (info.name === 'CompiledNode' && typeof event.data.compiled === 'string') {
      return event.data.compiled
    }
  }
  return null
}

/** Fallback for text logs: the SQL follows the "Compiled ... is:" banner. */
export function parseDbtCompiledFromTextLogs(stdout: string): string | null {
  const lines = stdout.split('\n')
  const banner = lines.findIndex((line) => /Compiled (inline )?node.* is:\s*$/.test(line))
  if (banner === -1) {
    return null
  }
  const body: string[] = []
  for (const line of lines.slice(banner + 1)) {
    // Why: dbt prefixes every later log line with a clock; the SQL never starts that way.
    if (/^\d{2}:\d{2}:\d{2}\s{2}/.test(line)) {
      break
    }
    body.push(line)
  }
  const sql = body.join('\n').trim()
  return sql.length > 0 ? sql : null
}

/**
 * dbt's JSON logs carry every error as an event too; this pulls the ERROR-level messages
 * out so the caller can show a reason instead of raw JSON.
 */
export function collectDbtJsonLogErrors(stdout: string): string[] {
  const errors: string[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    try {
      const event: unknown = JSON.parse(trimmed)
      if (isRecord(event) && isRecord(event.info) && event.info.level === 'error') {
        const message = event.info.msg
        if (typeof message === 'string' && message.trim().length > 0) {
          errors.push(message.trim())
        }
      }
    } catch {
      // Why: a truncated last line is not an error worth surfacing.
    }
  }
  return errors
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
