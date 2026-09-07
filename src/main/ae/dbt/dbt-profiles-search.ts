import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { safeHomedir } from './dbt-runner'

/**
 * Pod: where dbt should read profiles.yml from. The answer carries its source so the
 * Connection tab can say why a profile was chosen; values inside profiles.yml are
 * never read here.
 */
export type DbtProfilesSource = 'settings' | 'env' | 'project' | 'repo' | 'home' | 'dbt'

export type DbtProfilesLocation = {
  /** Undefined means "pass nothing and let dbt resolve it" (source 'dbt'). */
  dir?: string
  source: DbtProfilesSource
}

export type DbtProfilesSearchOptions = {
  projectDir: string
  repoRoot?: string | null
  /** Domain or settings override, used as given. */
  override?: string
  env?: NodeJS.ProcessEnv
  home?: string
}

export const DBT_PROFILES_FILE = 'profiles.yml'
/** Subfolders teams use to keep a repo-local profile next to the project. */
export const DBT_PROFILES_SUBDIRS = ['local_profiles', 'profiles', '.dbt'] as const

export function findDbtProfilesDir(options: DbtProfilesSearchOptions): DbtProfilesLocation {
  const override = options.override?.trim()
  if (override) {
    return { dir: override, source: 'settings' }
  }
  const fromEnv = (options.env ?? process.env).DBT_PROFILES_DIR?.trim()
  if (fromEnv) {
    return { dir: fromEnv, source: 'env' }
  }
  const projectHit = firstProfilesDir(options.projectDir)
  if (projectHit) {
    return { dir: projectHit, source: 'project' }
  }
  if (options.repoRoot && options.repoRoot !== options.projectDir) {
    const repoHit = firstProfilesDir(options.repoRoot)
    if (repoHit) {
      return { dir: repoHit, source: 'repo' }
    }
  }
  const homeRoot = options.home ?? safeHomedir()
  const home = homeRoot ? join(homeRoot, '.dbt') : null
  if (home && existsSync(join(home, DBT_PROFILES_FILE))) {
    return { dir: home, source: 'home' }
  }
  return { source: 'dbt' }
}

function firstProfilesDir(root: string): string | null {
  const candidates = [root, ...DBT_PROFILES_SUBDIRS.map((sub) => join(root, sub))]
  return candidates.find((dir) => existsSync(join(dir, DBT_PROFILES_FILE))) ?? null
}
