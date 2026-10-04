/** Pod: whether a copy of a dbt project can answer lineage and ref() lookups yet. */
export type DbtReadiness = {
  projectDir: string
  /** Entries in packages.yml / dependencies.yml. */
  packagesListed: number
  packagesInstalled: boolean
  manifest: boolean
  ready: boolean
}

export type DbtPrepareStep = 'packages-reuse' | 'packages-deps' | 'parse'

export type DbtPrepareFailureKind = 'no-dbt' | 'private-package' | 'packages' | 'parse'

export type DbtPrepareFailure = {
  kind: DbtPrepareFailureKind
  /** The variable a private git package's URL reads; the name only, never its value. */
  tokenVariable?: string
  /** dbt's own words, with env-file and secret values masked, for a "details" control. */
  details: string
}

export type DbtPrepareState = {
  projectDir: string
  state: 'idle' | 'running' | 'done' | 'failed'
  step?: DbtPrepareStep
  readiness: DbtReadiness
  failure?: DbtPrepareFailure
}
