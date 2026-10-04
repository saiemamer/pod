import type { AeDbtDistribution } from './dbt-settings-types'

/**
 * Pod: first setup from two folders. Detection reads files and runs `<tool> --version`;
 * apply turns the result into a domain, its dbt defaults and the tool paths.
 */
export type AeSetupDetectRequest = {
  dbtRepoPath: string
  omniRepoPath?: string
}

export type AeSetupItemStatus = 'found' | 'missing' | 'choose'

/** One row of the setup summary: what was found, or what the person can do about it. */
export type AeSetupItem = {
  key: 'dbt' | 'project' | 'profiles' | 'target' | 'omniRepo' | 'omni' | 'omniSignIn' | 'python'
  label: string
  status: AeSetupItemStatus
  value?: string
  hint?: string
}

export type AeSetupDbtCandidate = { path: string; ok: boolean; note?: string }

export type AeOmniSignIn = 'token-env' | 'cli-profile' | 'none'

export type AeSetupDetection = {
  dbtRepoPath: string
  omniRepoPath: string | null
  dbt: {
    binary: string | null
    distribution: AeDbtDistribution | null
    version: string | null
    /** Every candidate tried, in order, so a skipped broken shim is visible. */
    candidates: AeSetupDbtCandidate[]
  }
  project: { dir: string; name: string; profile: string | null } | null
  profiles: {
    dir: string | null
    /** Target names of the project's profile; never any other key from profiles.yml. */
    targets: string[]
    defaultTarget: string | null
  }
  /** Chosen target; null when the default looks like production or none was found. */
  target: string | null
  omniRepoIsModel: boolean
  omni: {
    binary: string | null
    version: string | null
    signIn: AeOmniSignIn
    baseUrl: string | null
  }
  python: { path: string | null; sqlglotVersion: string | null }
  items: AeSetupItem[]
}

export type AeSetupApplyRequest = {
  detection: AeSetupDetection
  /** The person's pick when detection left the target open. */
  target?: string
}

export type AeSetupApplyResult = {
  domainId: string
  created: boolean
  changed: boolean
}
