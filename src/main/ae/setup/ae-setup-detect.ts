import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AeSetupDetection, AeSetupItem, AeOmniSignIn } from '../../../shared/ae/setup-types'
import { findDbtProjectFile, readDbtProject } from '../dbt/dbt-project-discovery'
import { DBT_PROFILES_FILE, findDbtProfilesDir } from '../dbt/dbt-profiles-search'
import { detectAeRepoRole } from '../domain-repo-role'
import { readOmniCliProfile } from '../omni/omni-cli-sign-in'
import {
  probeDbt,
  probeOmni,
  probeSqlglotPython,
  type AeSetupProbeDeps
} from './ae-setup-tool-probes'

export type { AeSetupProbeDeps } from './ae-setup-tool-probes'

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

export async function detectAeSetup(
  request: { dbtRepoPath: string; omniRepoPath?: string },
  deps: AeSetupProbeDeps
): Promise<AeSetupDetection> {
  const dbtRepoPath = resolve(request.dbtRepoPath)
  const omniRepoPath = request.omniRepoPath?.trim() ? resolve(request.omniRepoPath) : null
  const projectFile = findDbtProjectFile(dbtRepoPath, dbtRepoPath)
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
      : null

  const [dbt, omni, python] = await Promise.all([
    probeDbt(repoDirs, deps),
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
    profiles: { dir: profilesDir, ...targets },
    target,
    omniRepoIsModel: omniRepoPath ? detectAeRepoRole(omniRepoPath) === 'omni' : false,
    omni: {
      ...omni,
      signIn: omniSignIn(deps.env, deps.home),
      baseUrl: deps.env.OMNI_BASE_URL?.trim() || null
    },
    python
  }
  return { ...detection, items: summarizeAeSetup(detection) }
}

export function summarizeAeSetup(d: Omit<AeSetupDetection, 'items'>): AeSetupItem[] {
  const items: AeSetupItem[] = []
  const skipped = d.dbt.candidates.filter((candidate) => !candidate.ok)
  const skippedNote =
    skipped.length > 0
      ? `Skipped ${skipped.map((c) => `${c.path} (${c.note ?? 'did not run'})`).join(', ')}.`
      : undefined
  items.push(
    d.dbt.binary
      ? {
          key: 'dbt',
          label: 'dbt',
          status: 'found',
          value:
            `${d.dbt.binary} (${d.dbt.distribution === 'fusion' ? 'Fusion' : 'Core'} ${d.dbt.version ?? ''})`.trim(),
          hint: skippedNote
        }
      : {
          key: 'dbt',
          label: 'dbt',
          status: 'missing',
          hint: `${skippedNote ?? 'No dbt found in the repo, beside it, or on your shell PATH.'} Install dbt (for example \`pipx install dbt-core dbt-bigquery\`) or set its path in Settings > Analytics Tools > Tools.`
        }
  )
  items.push(
    d.project
      ? {
          key: 'project',
          label: 'dbt project',
          status: 'found',
          value: `${d.project.name} in ${d.project.dir}${d.project.profile ? `, profile ${d.project.profile}` : ''}`
        }
      : {
          key: 'project',
          label: 'dbt project',
          status: 'missing',
          hint: 'No dbt_project.yml in this folder or one level down. Check the dbt repo path.'
        }
  )
  items.push(
    d.profiles.dir && d.profiles.targets.length > 0
      ? { key: 'profiles', label: 'Profiles folder', status: 'found', value: d.profiles.dir }
      : {
          key: 'profiles',
          label: 'Profiles folder',
          status: 'missing',
          value: d.profiles.dir ?? undefined,
          hint: d.profiles.dir
            ? `profiles.yml there has no "${d.project?.profile ?? '?'}" profile. Add it, or set the folder in Settings > Analytics Tools > dbt.`
            : 'No profiles.yml in DBT_PROFILES_DIR, the project, local_profiles/, profiles/ or ~/.dbt. dbt will use its own default.'
        }
  )
  items.push(targetItem(d))
  if (d.omniRepoPath) {
    items.push(
      d.omniRepoIsModel
        ? { key: 'omniRepo', label: 'Omni repo', status: 'found', value: d.omniRepoPath }
        : {
            key: 'omniRepo',
            label: 'Omni repo',
            status: 'missing',
            value: d.omniRepoPath,
            hint: 'No model.yaml or topic/view files here. It joins the domain as "other"; change its role in Domain settings if needed.'
          }
    )
  }
  items.push(
    d.omni.binary
      ? {
          key: 'omni',
          label: 'Omni CLI',
          status: 'found',
          value: `${d.omni.binary}${d.omni.version ? ` (${d.omni.version})` : ''}`
        }
      : {
          key: 'omni',
          label: 'Omni CLI',
          status: 'missing',
          hint: 'No omni on your shell PATH. Install it from github.com/exploreomni/cli or set its path in Settings > Analytics Tools > Tools.'
        }
  )
  items.push(omniSignInItem(d))
  items.push(
    d.python.path
      ? {
          key: 'python',
          label: 'Python with sqlglot',
          status: 'found',
          value: `${d.python.path}${d.python.sqlglotVersion ? ` (sqlglot ${d.python.sqlglotVersion})` : ''}`
        }
      : {
          key: 'python',
          label: 'Python with sqlglot',
          status: 'missing',
          hint: 'No Python here can import sqlglot. Column lineage falls back to matching column names until one is set in Settings > Analytics Tools > Tools.'
        }
  )
  return items
}

function targetItem(d: Omit<AeSetupDetection, 'items'>): AeSetupItem {
  if (d.target) {
    return { key: 'target', label: 'Default target', status: 'found', value: d.target }
  }
  if (d.profiles.defaultTarget) {
    return {
      key: 'target',
      label: 'Default target',
      status: 'choose',
      value: d.profiles.defaultTarget,
      hint: `The profile's default, "${d.profiles.defaultTarget}", looks like production, so Pod did not pick it. Choose the target Pod should use.`
    }
  }
  return {
    key: 'target',
    label: 'Default target',
    status: d.profiles.targets.length > 0 ? 'choose' : 'missing',
    hint:
      d.profiles.targets.length > 0
        ? 'The profile names no default target. Choose one.'
        : 'No targets found; dbt will use the profile as it stands.'
  }
}

function omniSignInItem(d: Omit<AeSetupDetection, 'items'>): AeSetupItem {
  const baseUrl = d.omni.baseUrl ? ` OMNI_BASE_URL ${d.omni.baseUrl} goes into the domain.` : ''
  if (d.omni.signIn === 'token-env') {
    return {
      key: 'omniSignIn',
      label: 'Omni sign-in',
      status: 'found',
      value: 'API token in your shell environment',
      hint: `Pod does not copy tokens. If Pod is opened from the Dock, add the token as OMNI_API_KEY under Secrets in Domain settings.${baseUrl}`
    }
  }
  if (d.omni.signIn === 'cli-profile') {
    return {
      key: 'omniSignIn',
      label: 'Omni sign-in',
      status: 'found',
      value: 'Omni CLI profile (omni config init or omni config login)',
      hint: `Pod lets the CLI use its own signed-in profile; no API key needed.${baseUrl}`
    }
  }
  return {
    key: 'omniSignIn',
    label: 'Omni sign-in',
    status: 'missing',
    hint: `The Omni CLI has no signed-in profile in ~/.config/omni-cli/config.json and no OMNI_API_TOKEN is set. Run \`omni config init\` in a terminal (an API key or a browser sign-in), or add OMNI_API_KEY under Secrets in Domain settings.${baseUrl}`
  }
}
