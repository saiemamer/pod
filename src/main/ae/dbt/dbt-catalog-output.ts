import type { DbtCatalogFailure, DbtCatalogSkip } from '../../../shared/ae/dbt-types'
import type { DbtRunResult } from './dbt-runner'

/**
 * Pod: reads what a catalog run left behind. dbt Core writes catalog.json even when some
 * datasets refuse access, lists those under `errors` and exits non-zero; and a failed run
 * prints dozens of Python warnings around the one line that says what went wrong.
 */

// e.g. `/venv/lib/python3.11/site-packages/agate/table/from_object.py:21: RuntimeWarning: ...`
const PYTHON_WARNING = /^\S.*\.py:\d+: \w*Warning\b/
const TIMESTAMP = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+/

/** Drops Python warning lines and the indented source lines Python prints under each. */
export function stripPythonWarnings(text: string): string {
  const kept: string[] = []
  let inWarning = false
  for (const line of text.split('\n')) {
    if (PYTHON_WARNING.test(line.trim())) {
      inWarning = true
      continue
    }
    if (inWarning && /^\s+\S/.test(line)) {
      continue
    }
    inWarning = false
    kept.push(line)
  }
  return kept.join('\n')
}

/** The `errors` of a catalog.json, one entry per dataset; null when the text is not a catalog. */
export function readDbtCatalogSkips(catalogText: string): DbtCatalogSkip[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(catalogText)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const errors = 'errors' in raw ? raw.errors : undefined
  if (!Array.isArray(errors)) {
    return []
  }
  const skips: DbtCatalogSkip[] = []
  const seen = new Set<string>()
  for (const entry of errors) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      continue
    }
    const dataset = datasetIn(entry)
    const message = firstMeaningfulLine(entry)
    const key = dataset ?? message
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    skips.push(dataset ? { dataset, message } : { message })
  }
  return skips
}

function datasetIn(text: string): string | undefined {
  // BigQuery: "Dataset proj:ds", "Table proj:ds.__TABLES__" (or INFORMATION_SCHEMA) or
  // ".../projects/proj/datasets/ds/..."; Snowflake and Postgres-likes: "Schema 'DB.SCHEMA'".
  const bigQuery = /\bDataset ([\w.-]+:[\w$-]+)/.exec(text)
  if (bigQuery) {
    return bigQuery[1]
  }
  const table = /\bTable ([\w.-]+:[\w$-]+)\./.exec(text)
  if (table) {
    return table[1]
  }
  const url = /projects\/([^/\s]+)\/datasets\/([^/?\s]+)/.exec(text)
  if (url) {
    return `${url[1]}:${url[2]}`
  }
  return /\bschema ['"]([^'"]+)['"]/i.exec(text)?.[1]
}

function firstMeaningfulLine(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.replace(TIMESTAMP, '').trim())
    .find((part) => part.length > 0 && !/^(Database|Runtime) Error$/.test(part))
  return line ?? text.trim()
}

const NODE_ERROR =
  /(Database|Compilation|Runtime|Parsing|Dependency) Error in (model|seed|snapshot|source|test|analysis|sql operation) (\S+) \(([^)]+)\)/

/** dbt's failure as a title, the missing piece, a next step, and its own text for details. */
export function describeDbtCatalogFailure(
  result: DbtRunResult | undefined,
  fallbackMessage: string,
  step: string
): DbtCatalogFailure {
  if (!result) {
    return { title: `${step} did not start`, hint: fallbackMessage, details: fallbackMessage }
  }
  const details = stripPythonWarnings([result.stdout, result.stderr].join('\n')).trim()
  if (result.timedOut) {
    return {
      title: `${step} timed out after ${Math.round(result.durationMs / 1000)}s`,
      hint: 'Run it in a terminal in the project to see how far it gets.',
      details
    }
  }
  const lines = details
    .split('\n')
    .map((line) => line.replace(TIMESTAMP, '').trim())
    .filter((line) => line.length > 0)
  let title = `${step} failed`
  let reason: string | undefined
  const nodeIndex = lines.findIndex((line) => NODE_ERROR.test(line))
  if (nodeIndex !== -1) {
    const match = NODE_ERROR.exec(lines[nodeIndex])
    if (match) {
      title = `Stopped at ${match[2]} ${match[3]} (${match[4]})`
    }
    reason = lines.slice(nodeIndex + 1).find((line) => !/^compiled code at /i.test(line))
  } else {
    const errorIndex = lines.findIndex((line) => /Encountered an error|Error:?$/.test(line))
    reason =
      errorIndex !== -1
        ? (lines.slice(errorIndex + 1).find((line) => !/^(Runtime|Database) Error$/.test(line)) ??
          lines[errorIndex])
        : lines.at(-1)
  }
  return {
    title,
    ...(reason ? { reason } : {}),
    hint: hintFor(`${reason ?? ''}\n${details}`, result.command),
    details: details.length > 0 ? details : `exit code ${result.code ?? 'unknown'}`
  }
}

function hintFor(text: string, command: string): string {
  if (/Not found: (Table|View)/i.test(text)) {
    return 'That table has not been built under this target. Build it here, or point the target at a dataset where it exists.'
  }
  if (/Not found: Dataset/i.test(text)) {
    return "That dataset does not exist under this target. Check the target's dataset in the profile."
  }
  if (/Access Denied|Permission .* denied|not authorized|insufficient privileges/i.test(text)) {
    return 'The account dbt signs in with may not read this. Ask for read access, or use a target that can.'
  }
  if (/Reauthenticat|credentials|access token|invalid_grant|RefreshError|gcloud auth/i.test(text)) {
    return 'dbt could not sign in to the warehouse. Sign in again (BigQuery: gcloud auth application-default login) and retry.'
  }
  if (/Could not find profile|profiles\.yml|does not have a target named/i.test(text)) {
    return 'dbt could not read the profile or target. Check them in Settings > Analytics Tools.'
  }
  if (/Env var required/i.test(text)) {
    return "An environment variable the project needs is not set. Add it to the project's .env file."
  }
  return `Run \`${command}\` in a terminal in the project to see the whole output.`
}
