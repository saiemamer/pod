/** dbt defaults and external tool paths, stored in global settings as optional keys. */
export type AeToolCmdOverrides = {
  dbt?: string
  omni?: string
  python?: string
}

export const AE_DBT_DISTRIBUTIONS = ['core', 'fusion'] as const
export type AeDbtDistribution = (typeof AE_DBT_DISTRIBUTIONS)[number]

export type AeDbtSettings = {
  /** Row cap for `dbt show`; BigQuery bills per query, so keep it visible and bounded. */
  showLimit: number
  target?: string
  profilesDir?: string
  projectDir?: string
  env: Record<string, string>
  envFile?: string
  parseOnLoad: boolean
  lineageDepth: number
  lineageTreeDepth: number
  lineageMaxNodes: number
  distribution: AeDbtDistribution
  coreAdapter: string
}

export const AE_DBT_SHOW_LIMIT_MAX = 500

export const DEFAULT_AE_DBT_SETTINGS: AeDbtSettings = {
  showLimit: 500,
  env: {},
  parseOnLoad: true,
  lineageDepth: 4,
  lineageTreeDepth: 8,
  lineageMaxNodes: 500,
  distribution: 'core',
  coreAdapter: 'bigquery'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function optionalPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function normalizeAeToolCmdOverrides(value: unknown): AeToolCmdOverrides {
  if (!isRecord(value)) {
    return {}
  }
  const overrides: AeToolCmdOverrides = {}
  for (const tool of ['dbt', 'omni', 'python'] as const) {
    const path = optionalPath(value[tool])
    if (path) {
      overrides[tool] = path
    }
  }
  return overrides
}

export function normalizeAeDbtSettings(value: unknown): AeDbtSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_AE_DBT_SETTINGS }
  }
  const env: Record<string, string> = {}
  if (isRecord(value.env)) {
    for (const [key, entry] of Object.entries(value.env)) {
      if (typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        env[key] = entry
      }
    }
  }
  const settings: AeDbtSettings = {
    showLimit: clampInt(
      value.showLimit,
      DEFAULT_AE_DBT_SETTINGS.showLimit,
      1,
      AE_DBT_SHOW_LIMIT_MAX
    ),
    env,
    parseOnLoad: typeof value.parseOnLoad === 'boolean' ? value.parseOnLoad : true,
    lineageDepth: clampInt(value.lineageDepth, DEFAULT_AE_DBT_SETTINGS.lineageDepth, 1, 20),
    lineageTreeDepth: clampInt(
      value.lineageTreeDepth,
      DEFAULT_AE_DBT_SETTINGS.lineageTreeDepth,
      1,
      40
    ),
    lineageMaxNodes: clampInt(
      value.lineageMaxNodes,
      DEFAULT_AE_DBT_SETTINGS.lineageMaxNodes,
      10,
      5000
    ),
    distribution: AE_DBT_DISTRIBUTIONS.includes(value.distribution as AeDbtDistribution)
      ? (value.distribution as AeDbtDistribution)
      : 'core',
    coreAdapter:
      typeof value.coreAdapter === 'string' && value.coreAdapter.length > 0
        ? value.coreAdapter
        : DEFAULT_AE_DBT_SETTINGS.coreAdapter
  }
  for (const key of ['target', 'profilesDir', 'projectDir', 'envFile'] as const) {
    const path = optionalPath(value[key])
    if (path) {
      settings[key] = path
    }
  }
  return settings
}
