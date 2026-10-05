import type { AeSetupDetection, AeSetupItem } from '../../../shared/ae/setup-types'

/** Pod: the setup summary, one row per item, each with what was found or what to do about it. */
export function summarizeAeSetup(d: Omit<AeSetupDetection, 'items'>): AeSetupItem[] {
  const items: AeSetupItem[] = []
  const skipped = d.dbt.candidates.filter((candidate) => !candidate.ok)
  const skippedNote =
    skipped.length > 0
      ? skipped.map((c) => `Pod skipped ${c.path}: ${c.note ?? 'it does not start'}.`).join(' ')
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
          hint: `${skippedNote ?? 'No dbt found in the repo, beside it, or on your shell PATH.'} If dbt works in your terminal, run \`which dbt\` there and give Pod that path. Otherwise install it, for example with \`pipx install dbt-core dbt-bigquery\`.`
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
          status: d.projectDirs.length > 1 ? 'choose' : 'missing',
          hint:
            d.projectDirs.length > 1
              ? `This repo holds ${d.projectDirs.length} dbt projects. Choose the one Pod should use.`
              : 'No dbt_project.yml in this folder or one level down. Check the dbt repo path.'
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
          hint: 'No Python here has sqlglot of its own. Column lineage still uses the copy built into Pod, run by the Python that runs dbt or python3 on PATH.'
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
