import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { isWithin } from './dbt-project-discovery'

/**
 * Pod: `.env` files a dbt project expects (dbt-analytics reads PERSONAL_DATASET and
 * friends from one). Values are returned to the caller for a child env and nothing
 * else; only file names are reported upward.
 */
export type DbtEnvFilesOptions = {
  projectDir: string
  repoRoot?: string | null
  /** Settings override, absolute or relative to projectDir; applied last. */
  envFile?: string
  readFile?: (path: string) => string | null
}

export type DbtEnvFiles = {
  values: Record<string, string>
  /** Files that existed, in the order they were applied. */
  files: string[]
}

const ENV_FILE_NAMES = ['.env', '.env.local'] as const
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = assignment.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = assignment.slice(0, eq).trim()
    if (!KEY_PATTERN.test(key)) {
      continue
    }
    values[key] = parseValue(assignment.slice(eq + 1).trim())
  }
  return values
}

function parseValue(raw: string): string {
  if (raw.length === 0) {
    return ''
  }
  const quote = raw[0]
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw.endsWith(quote)) {
    const inner = raw.slice(1, -1)
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner
  }
  // Why: dotenv treats ` #` after an unquoted value as a comment.
  const comment = raw.indexOf(' #')
  return (comment === -1 ? raw : raw.slice(0, comment)).trim()
}

/**
 * Walk from the repo root down to the project directory, applying `.env` then
 * `.env.local` at each level so deeper files override shallower ones, then the explicit
 * settings file. The caller decides how the result ranks against the real environment.
 */
export function loadDbtEnvFiles(options: DbtEnvFilesOptions): DbtEnvFiles {
  const read = options.readFile ?? defaultRead
  const projectDir = resolve(options.projectDir)
  const root = options.repoRoot ? resolve(options.repoRoot) : null
  const dirs = root && isWithin(projectDir, root) ? chain(root, projectDir) : [projectDir]
  const values: Record<string, string> = {}
  const files: string[] = []
  const apply = (file: string): void => {
    const text = read(file)
    if (text === null) {
      return
    }
    Object.assign(values, parseDotEnv(text))
    files.push(file)
  }
  for (const dir of dirs) {
    for (const name of ENV_FILE_NAMES) {
      apply(join(dir, name))
    }
  }
  const explicit = options.envFile?.trim()
  if (explicit) {
    apply(isAbsolute(explicit) ? explicit : resolve(projectDir, explicit))
  }
  return { values, files }
}

function chain(root: string, leaf: string): string[] {
  const dirs: string[] = []
  let dir = leaf
  while (dir !== root) {
    dirs.unshift(dir)
    const parent = dirname(dir)
    if (parent === dir || (!parent.startsWith(`${root}${sep}`) && parent !== root)) {
      break
    }
    dir = parent
  }
  dirs.unshift(root)
  return dirs
}

function defaultRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
