import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pod: where Omni CLI 1.0.4 keeps its sign-in and whether it holds one, read the way
 * `internal/config/config.go` in github.com/exploreomni/cli reads it. The CLI takes its
 * token from `--token`, else `OMNI_API_TOKEN`, else the default profile in this file,
 * and its address from `--base-url`, else `OMNI_BASE_URL`, else the profile.
 */
export function omniCliConfigPath(
  env: NodeJS.ProcessEnv,
  home: string | null,
  platform: NodeJS.Platform = process.platform
): string | null {
  const explicit = env.OMNI_CONFIG_PATH?.trim()
  if (explicit) {
    return explicit
  }
  const dir = omniCliConfigDir(env, home, platform)
  return dir ? join(dir, 'config.json') : null
}

function omniCliConfigDir(
  env: NodeJS.ProcessEnv,
  home: string | null,
  platform: NodeJS.Platform
): string | null {
  const explicit = env.OMNI_CONFIG_DIR?.trim()
  if (explicit) {
    return explicit
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) {
    return join(xdg, 'omni-cli')
  }
  if (platform === 'win32') {
    return env.APPDATA ? join(env.APPDATA, 'omni-cli') : null
  }
  // Why not ~/Library/Application Support on macOS: the CLI follows XDG there too.
  return home ? join(home, '.config', 'omni-cli') : null
}

export type OmniCliProfile = {
  path: string
  profile: string | null
  /** The default profile holds an API key, or an OAuth access token from `omni config login`. */
  signedIn: boolean
  apiEndpoint: string | null
}

/** Null when the CLI has no config file. Secrets never leave this function. */
export function readOmniCliProfile(
  env: NodeJS.ProcessEnv,
  home: string | null,
  platform: NodeJS.Platform = process.platform
): OmniCliProfile | null {
  const path = omniCliConfigPath(env, home, platform)
  if (!path) {
    return null
  }
  let doc: unknown
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  const profileName = str(field(doc, 'defaultProfile'))
  const profile = profileName ? field(field(doc, 'profiles'), profileName) : undefined
  // Why: the CLI reads accessToken for "oauth" and apiKey for anything else.
  const token =
    field(profile, 'authMethod') === 'oauth'
      ? field(profile, 'accessToken')
      : field(profile, 'apiKey')
  return {
    path,
    profile: profile === undefined ? null : profileName,
    signedIn: Boolean(str(token)),
    apiEndpoint: str(field(profile, 'apiEndpoint'))
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
