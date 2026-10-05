import type { AeDbtDistribution } from './dbt-settings-types'
import type { AeRepoRole } from './domain-types'

/**
 * Pod: first setup from two folders. Detection reads files and runs `<tool> --version`;
 * apply turns the result into a domain, its dbt defaults and the tool paths.
 */
export type AeSetupDetectRequest = {
  dbtRepoPath: string
  omniRepoPath?: string
  /** The person's pick when the repo holds more than one dbt project. */
  projectDir?: string
  /** A dbt the person pointed at; tried before every other candidate. */
  dbtBinary?: string
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
  /** Every dbt project at the repo root or one level down; more than one is a choice. */
  projectDirs: string[]
  /** Each repo's role as its checkout suggests (dbt, omni or other). */
  dbtRepoRole: AeRepoRole
  omniRepoRole: AeRepoRole | null
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

/** One call: detect, then apply unless something needs the person. */
export type AeSetupRunRequest = AeSetupDetectRequest & {
  target?: string
  /** The person chose to go on although no dbt runs. */
  withoutDbt?: boolean
}

/** What Pod could not choose safely, each with the options it offers. */
export type AeSetupQuestion =
  | { kind: 'target'; options: string[]; reason: string }
  | { kind: 'project'; options: string[]; reason: string }
  | { kind: 'dbt'; reason: string }

export type AeSetupRunResult = {
  detection: AeSetupDetection
  questions: AeSetupQuestion[]
  /** Null while a question is open. */
  applied: AeSetupApplyResult | null
}

/** The registered repo behind a path (a worktree maps to its repo), for offering setup. */
export type AeSetupRepoInfo = {
  repoPath: string
  role: AeRepoRole
  domainId: string | null
}

/** What a setup dialog opens with: a dbt repo starts at once, an Omni repo waits for its dbt repo. */
export type AeSetupInitial = { dbtRepoPath?: string; omniRepoPath?: string }
