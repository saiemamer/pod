import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  AeSetupDetectRequest,
  AeSetupDetection,
  AeOmniSignIn
} from '../../../shared/ae/setup-types'
import { findDbtProjectFile, readDbtProject } from '../dbt/dbt-project-discovery'
import { DBT_PROFILES_FILE, findDbtProfilesDir } from '../dbt/dbt-profiles-search'
import { detectAeRepoRole } from '../domain-repo-role'
import { readOmniCliProfile } from '../omni/omni-cli-sign-in'
import { summarizeAeSetup } from './ae-setup-summary'
import {
  probeDbt,
  probeOmni,
  probeSqlglotPython,
  type AeSetupProbeDeps
} from './ae-setup-tool-probes'

export type { AeSetupProbeDeps } from './ae-setup-tool-probes'
export { summarizeAeSetup } from './ae-setup-summary'

/** Names a team gives the target that writes to production. */
const PRODUCTION_TARGET = /(^|[-_.])(prod|production|prd|live)($|[-_.])/i

export function looksLikeProductionTarget(name: string): boolean {
  return PRODUCTION_TARGET.test(name)
}

type ProfileTargets = { targets: string[]; defaultTarget: string | null }

/**
 * Only the profile's output names and its `target:` leave this function; credentials in
 * profiles.yml are never copied out. A Jinja default (`env_var('X', 'dev')`) resolves
 * against the login shell's env.
 */
export function readProfileTargets(
  profilesDir: string,
  profile: string,
  env: NodeJS.ProcessEnv
): ProfileTargets {
  let doc: unknown
  try {
    doc = parseYaml(readFileSync(join(profilesDir, DBT_PROFILES_FILE), 'utf8'), {
      uniqueKeys: false
    })
  } catch {
    return { targets: [], defaultTarget: null }
  }
  const entry = isRecord(doc) ? doc[profile] : undefined
  if (!isRecord(entry)) {
    return { targets: [], defaultTarget: null }
  }
  const targets = isRecord(entry.outputs) ? Object.keys(entry.outputs) : []
  const raw = typeof entry.target === 'string' ? entry.target.trim() : ''
  return { targets, defaultTarget: resolveJinjaTarget(raw, env) }
}

function resolveJinjaTarget(raw: string, env: NodeJS.ProcessEnv): string | null {
  if (!raw.includes('{{')) {
    return raw || null
  }
  const match = /env_var\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"])?\s*\)/.exec(raw)
  if (!match) {
    return null
  }
  return env[match[1]]?.trim() || match[2] || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function omniSignIn(env: NodeJS.ProcessEnv, home: string | null): AeOmniSignIn {
  if (env.OMNI_API_TOKEN?.trim() || env.OMNI_API_KEY?.trim()) {
    return 'token-env'
  }
  // Why not the file alone: a config with no default profile or no token fails every call.
  return readOmniCliProfile(env, home)?.signedIn ? 'cli-profile' : 'none'
}

/** dbt projects at the repo root, or else one level down; packages and build output are not projects. */
function listDbtProjectDirs(repoPath: string): string[] {
  if (existsSync(join(repoPath, 'dbt_project.yml'))) {
    return [repoPath]
  }
  let entries: string[] = []
  try {
    entries = readdirSync(repoPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NOT_PROJECT_DIRS.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
  return entries
    .map((name) => join(repoPath, name))
    .filter((dir) => existsSync(join(dir, 'dbt_project.yml')))
}

const NOT_PROJECT_DIRS = /^(\.|node_modules$|dbt_packages$|dbt_modules$|target$|logs$)/

export async function detectAeSetup(
  request: AeSetupDetectRequest,
  deps: AeSetupProbeDeps
): Promise<AeSetupDetection> {
  const dbtRepoPath = resolve(request.dbtRepoPath)
  const omniRepoPath = request.omniRepoPath?.trim() ? resolve(request.omniRepoPath) : null
  const projectDirs = listDbtProjectDirs(dbtRepoPath)
  const chosenDir = request.projectDir ? resolve(request.projectDir) : null
  // Why no project when several and none chosen: guessing one would set up the wrong profile.
  const projectFile =
    chosenDir && projectDirs.includes(chosenDir)
      ? join(chosenDir, 'dbt_project.yml')
      : projectDirs.length > 1
        ? null
        : findDbtProjectFile(dbtRepoPath, dbtRepoPath)
  const projectInfo = projectFile ? readDbtProject(projectFile) : null
  const project = projectInfo
    ? { dir: projectInfo.projectDir, name: projectInfo.name, profile: projectInfo.profile ?? null }
    : null
  const repoDirs = project ? [project.dir, dbtRepoPath] : [dbtRepoPath]

  const location = findDbtProfilesDir({
    projectDir: project?.dir ?? dbtRepoPath,
    repoRoot: dbtRepoPath,
    env: deps.env,
    home: deps.home ?? undefined
  })
  const profilesDir = location.dir ?? null
  const targets =
    profilesDir && project?.profile
      ? readProfileTargets(profilesDir, project.profile, deps.env)
      : { targets: [], defaultTarget: null }
  const target =
    targets.defaultTarget && !looksLikeProductionTarget(targets.defaultTarget)
      ? targets.defaultTarget
      : !targets.defaultTarget && targets.targets.length === 1
        ? targets.targets[0]
        : null

  const omniRepoRole = omniRepoPath ? detectAeRepoRole(omniRepoPath) : null
  const [dbt, omni, python] = await Promise.all([
    probeDbt(repoDirs, deps, request.dbtBinary),
    probeOmni(deps),
    probeSqlglotPython(repoDirs, deps)
  ])
  const detection: Omit<AeSetupDetection, 'items'> = {
    dbtRepoPath,
    omniRepoPath,
    dbt: {
      binary: dbt.binary,
      distribution: dbt.info?.distribution ?? null,
      version: dbt.info?.version ?? null,
      candidates: dbt.tried
    },
    project,
    projectDirs,
    dbtRepoRole: detectAeRepoRole(dbtRepoPath),
    omniRepoRole,
    omniRepoIsModel: omniRepoRole === 'omni',
    profiles: { dir: profilesDir, ...targets },
    target,
    omni: {
      ...omni,
      signIn: omniSignIn(deps.env, deps.home),
      baseUrl: deps.env.OMNI_BASE_URL?.trim() || null
    },
    python
  }
  return { ...detection, items: summarizeAeSetup(detection) }
}
