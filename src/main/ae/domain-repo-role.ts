import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AeRepoRole } from '../../shared/ae/domain-types'

/**
 * Guess a repo's role from its checkout: a dbt project carries dbt_project.yml (at the root
 * or one level down, as some repos keep it under dbt/); an Omni model repo carries
 * model.yaml or Omni topic/view YAML files, at the root or up to two levels down
 * (omni-analytics keeps its model under omni/<model name>/). Anything else is 'other'.
 */
export function detectAeRepoRole(repoPath: string): AeRepoRole {
  if (hasDbtProject(repoPath)) {
    return 'dbt'
  }
  if (hasOmniModel(repoPath, 2)) {
    return 'omni'
  }
  return 'other'
}

function hasDbtProject(repoPath: string): boolean {
  if (existsSync(join(repoPath, 'dbt_project.yml'))) {
    return true
  }
  for (const child of listDirs(repoPath)) {
    if (existsSync(join(repoPath, child, 'dbt_project.yml'))) {
      return true
    }
  }
  return false
}

function hasOmniModel(path: string, depth: number): boolean {
  if (existsSync(join(path, 'model.yaml')) || existsSync(join(path, 'model.yml'))) {
    return true
  }
  for (const dir of ['topics', 'views', 'relationships']) {
    const full = join(path, dir)
    if (!existsSync(full)) {
      continue
    }
    const entries = safeReaddir(full)
    if (entries.some((name) => /\.(topic|view|relationships?)\.ya?ml$/.test(name))) {
      return true
    }
  }
  if (depth === 0) {
    return false
  }
  return listDirs(path).some((child) => hasOmniModel(join(path, child), depth - 1))
}

function listDirs(path: string): string[] {
  return safeReaddir(path).filter((name) => {
    if (name.startsWith('.') || name === 'node_modules') {
      return false
    }
    try {
      return statSync(join(path, name)).isDirectory()
    } catch {
      return false
    }
  })
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}
