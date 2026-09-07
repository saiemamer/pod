import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Pod: find the dbt project a path belongs to and read the few dbt_project.yml keys the
 * editor, the runner and the CLI need. Nothing here runs dbt.
 */
export const DBT_PROJECT_FILE = 'dbt_project.yml'

export type DbtProjectInfo = {
  /** Directory holding dbt_project.yml; every dbt command runs from here. */
  projectDir: string
  projectFile: string
  name: string
  profile?: string
  /** Relative to projectDir, as dbt_project.yml declares them. */
  modelPaths: string[]
  macroPaths: string[]
  targetPath: string
}

export type DiscoverDbtProjectOptions = {
  /** File or directory to start from: the open file, or the caller's cwd. */
  startPath: string
  /** Never walk above this directory (the worktree root). */
  stopAt?: string
  /** Settings override; absolute, or relative to stopAt (else to the start directory). */
  projectDir?: string
}

export function discoverDbtProject(options: DiscoverDbtProjectOptions): DbtProjectInfo | null {
  const override = resolveProjectDirOverride(options)
  if (override) {
    return readDbtProject(join(override, DBT_PROJECT_FILE))
  }
  const file = findDbtProjectFile(options.startPath, options.stopAt)
  return file ? readDbtProject(file) : null
}

/**
 * Nearest dbt_project.yml at or above startPath, bounded by stopAt. When the walk finds
 * nothing, look one level below the top directory, because some repos keep the project
 * in a subfolder (dbt-analytics used dbt/).
 */
export function findDbtProjectFile(startPath: string, stopAt?: string): string | null {
  const start = resolve(startPath)
  const stop = stopAt ? resolve(stopAt) : null
  let dir = isDirectory(start) ? start : dirname(start)
  if (stop && !isWithin(dir, stop)) {
    dir = stop
  }
  for (;;) {
    const candidate = join(dir, DBT_PROJECT_FILE)
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir || (stop && !isWithin(parent, stop))) {
      break
    }
    dir = parent
  }
  const top = stop ?? (isDirectory(start) ? start : dirname(start))
  for (const child of listDirs(top)) {
    const candidate = join(top, child, DBT_PROJECT_FILE)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function readDbtProject(projectFile: string): DbtProjectInfo {
  const file = resolve(projectFile)
  const projectDir = dirname(file)
  let doc: Record<string, unknown> = {}
  try {
    // Why uniqueKeys off: dbt itself tolerates a repeated key, and a parse failure here
    // would hide the whole project rather than one bad line.
    const parsed: unknown = parseYaml(readFileSync(file, 'utf8'), { uniqueKeys: false })
    if (isRecord(parsed)) {
      doc = parsed
    }
  } catch {
    doc = {}
  }
  return {
    projectDir,
    projectFile: file,
    name: nonEmptyString(doc.name) ?? basename(projectDir),
    profile: nonEmptyString(doc.profile),
    modelPaths: stringList(doc['model-paths'], ['models']),
    macroPaths: stringList(doc['macro-paths'], ['macros']),
    targetPath: nonEmptyString(doc['target-path']) ?? 'target'
  }
}

/** True when `path` is `root` or lies below it. */
export function isWithin(path: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root.slice(0, -sep.length) : root
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}${sep}`)
}

function resolveProjectDirOverride(options: DiscoverDbtProjectOptions): string | null {
  if (!options.projectDir || options.projectDir.trim().length === 0) {
    return null
  }
  const start = resolve(options.startPath)
  const base = options.stopAt ?? (isDirectory(start) ? start : dirname(start))
  const dir = isAbsolute(options.projectDir)
    ? options.projectDir
    : resolve(base, options.projectDir)
  return existsSync(join(dir, DBT_PROJECT_FILE)) ? dir : null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function listDirs(path: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(path)
  } catch {
    return []
  }
  return entries
    .filter((name) => !name.startsWith('.') && name !== 'node_modules' && name !== 'target')
    .filter((name) => isDirectory(join(path, name)))
    .sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()]
  }
  if (Array.isArray(value)) {
    const list = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (list.length > 0) {
      return list
    }
  }
  return fallback
}
