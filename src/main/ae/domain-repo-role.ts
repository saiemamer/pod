import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AeRepoRole } from '../../shared/ae/domain-types'

/**
 * Guess a repo's role from its checkout: a dbt project carries dbt_project.yml (at the root
 * or one level down, as dbt-analytics keeps it under dbt/); an Omni model repo carries
 * model.yaml or Omni topic/view YAML files. Anything else is 'other'.
 */
export function detectAeRepoRole(repoPath: string): AeRepoRole {
  if (hasDbtProject(repoPath)) {
    return 'dbt'
  }
  if (hasOmniModel(repoPath)) {
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

function hasOmniModel(repoPath: string): boolean {
  if (existsSync(join(repoPath, 'model.yaml')) || existsSync(join(repoPath, 'model.yml'))) {
    return true
  }
  for (const dir of ['topics', 'views', 'relationships']) {
    const full = join(repoPath, dir)
    if (!existsSync(full)) {
      continue
    }
    const entries = safeReaddir(full)
    if (entries.some((name) => /\.(topic|view|relationships?)\.ya?ml$/.test(name))) {
      return true
    }
  }
  return false
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
