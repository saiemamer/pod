import { readdirSync, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import type { DbtResolveRefResult } from '../../../shared/ae/dbt-types'
import type { DbtProjectInfo } from './dbt-project-discovery'

/**
 * Pod: `ref('x')` → the model file, by scanning the project's model paths for x.sql.
 * A file scan needs no manifest and no language server, so Cmd-click works the moment
 * a project opens. The manifest, when present, disambiguates by package.
 */
const SCAN_DEPTH_MAX = 12
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'target', 'dbt_packages', 'dbt_modules'])

export function findDbtModelFiles(project: DbtProjectInfo, name: string): string[] {
  const wanted = `${name}.sql`.toLowerCase()
  const matches: string[] = []
  for (const modelPath of project.modelPaths) {
    walk(join(project.projectDir, modelPath), 0, (file) => {
      if (basename(file).toLowerCase() === wanted) {
        matches.push(file)
      }
    })
  }
  return matches.sort()
}

export function resolveDbtRef(
  project: DbtProjectInfo,
  name: string,
  preferredFile?: string | null
): DbtResolveRefResult {
  const trimmed = name.trim()
  const matches = trimmed ? findDbtModelFiles(project, trimmed) : []
  // Why: the manifest's original_file_path names the one dbt uses when two packages collide.
  const preferred = preferredFile ? matches.find((file) => file === preferredFile) : undefined
  const file = preferred ?? matches[0] ?? null
  return {
    name: trimmed,
    file,
    alternatives: matches.filter((match) => match !== file)
  }
}

function walk(dir: string, depth: number, visit: (file: string) => void): void {
  if (depth > SCAN_DEPTH_MAX) {
    return
  }
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        walk(join(dir, entry.name), depth + 1, visit)
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      visit(join(dir, entry.name))
    }
  }
}
