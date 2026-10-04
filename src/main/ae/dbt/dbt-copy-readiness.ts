import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { DbtReadiness } from '../../../shared/ae/dbt-readiness-types'
import { isWithin, type DbtProjectInfo } from './dbt-project-discovery'
import { dbtManifestPath } from './dbt-manifest'

/**
 * Pod: what a copy of a dbt project still lacks (installed packages, a manifest), and
 * where the main copy of the same repo lives, so a fresh worktree can borrow from it.
 * Reads files only; nothing here runs dbt.
 */
export const DBT_PACKAGE_FILES = ['packages.yml', 'dependencies.yml', 'package-lock.yml'] as const
const PACKAGE_ENTRY_KEYS = ['package', 'git', 'local', 'tarball', 'private'] as const

export function dbtPackagesInstallDir(project: DbtProjectInfo): string {
  let configured: unknown
  try {
    const doc: unknown = parseYaml(readFileSync(project.projectFile, 'utf8'), {
      uniqueKeys: false
    })
    configured = isRecord(doc) ? doc['packages-install-path'] : undefined
  } catch {
    configured = undefined
  }
  const dir = typeof configured === 'string' && configured.trim() ? configured.trim() : null
  return dir ? resolve(project.projectDir, dir) : join(project.projectDir, 'dbt_packages')
}

/** The entries of packages.yml and dependencies.yml (only `packages:` entries count). */
export function readDbtPackageEntries(projectDir: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = []
  for (const name of ['packages.yml', 'dependencies.yml']) {
    const text = readText(join(projectDir, name))
    if (text === null) {
      continue
    }
    let doc: unknown
    try {
      doc = parseYaml(text, { uniqueKeys: false })
    } catch {
      doc = null
    }
    const list = isRecord(doc) ? doc.packages : null
    if (Array.isArray(list)) {
      entries.push(...list.filter(isRecord))
    } else {
      // Why: unquoted Jinja in a git URL can break the YAML parse; count entry lines instead.
      for (const line of text.split(/\r?\n/)) {
        const match = /^\s*-\s*(\w+)\s*:\s*(.*)$/.exec(line)
        if (match && isPackageEntryKey(match[1])) {
          entries.push({ [match[1]]: match[2] })
        }
      }
    }
  }
  return entries.filter((entry) => PACKAGE_ENTRY_KEYS.some((key) => key in entry))
}

/** Variable names the git package entries read through env_var(); names only. */
export function dbtGitPackageTokenVariables(projectDir: string): string[] {
  const names = new Set<string>()
  for (const entry of readDbtPackageEntries(projectDir)) {
    const url = entry.git
    if (typeof url !== 'string') {
      continue
    }
    for (const match of url.matchAll(/env_var\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)) {
      names.add(match[1])
    }
  }
  return [...names]
}

export function checkDbtReadiness(project: DbtProjectInfo): DbtReadiness {
  const packagesListed = readDbtPackageEntries(project.projectDir).length
  const installed = countInstalled(dbtPackagesInstallDir(project))
  const packagesInstalled = packagesListed === 0 || installed >= packagesListed
  const manifest = existsSync(dbtManifestPath(project))
  return {
    projectDir: project.projectDir,
    packagesListed,
    packagesInstalled,
    manifest,
    ready: packagesInstalled && manifest
  }
}

/**
 * The main checkout behind a linked git worktree, read from the worktree's `.git` file
 * (`gitdir:` then `commondir`), so no git process runs. Null for a main checkout.
 */
export function findPrimaryCheckout(worktreeRoot: string): string | null {
  const pointer = readText(join(worktreeRoot, '.git'))
  const gitdirLine = pointer
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('gitdir:'))
    ?.slice('gitdir:'.length)
    .trim()
  if (!gitdirLine) {
    return null
  }
  const gitdir = isAbsolute(gitdirLine) ? gitdirLine : resolve(worktreeRoot, gitdirLine)
  const common = readText(join(gitdir, 'commondir'))?.trim()
  if (!common) {
    return null
  }
  const commonDir = isAbsolute(common) ? common : resolve(gitdir, common)
  // Why: a bare common dir has no checkout whose files a copy could borrow.
  if (!commonDir.endsWith('.git')) {
    return null
  }
  const primary = dirname(commonDir)
  return primary !== resolve(worktreeRoot) && existsSync(primary) ? primary : null
}

/** The same project inside the main checkout, when the copy sits in a linked worktree. */
export function primaryProjectDir(
  projectDir: string,
  repoRoot: string | null,
  primaryRoot: string | null
): string | null {
  if (!repoRoot || !primaryRoot || !isWithin(projectDir, repoRoot)) {
    return null
  }
  const dir = join(primaryRoot, relative(repoRoot, projectDir))
  return existsSync(join(dir, 'dbt_project.yml')) ? dir : null
}

/** True when both copies list the same packages, byte for byte, in every package file. */
export function samePackageFiles(a: string, b: string): boolean {
  return DBT_PACKAGE_FILES.every((name) => readText(join(a, name)) === readText(join(b, name)))
}

function countInstalled(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink())
    ).length
  } catch {
    return 0
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isPackageEntryKey(key: string): boolean {
  return PACKAGE_ENTRY_KEYS.some((known) => known === key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
