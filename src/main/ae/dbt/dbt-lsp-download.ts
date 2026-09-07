import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

/**
 * Pod: fetches the pinned dbt-language-server release (j-clemons/dbt-language-server,
 * MIT, a Go binary) into userData once, verifies its hash, and prunes older versions.
 * Nothing here runs the server; the bridge does that.
 */
export const DBT_LSP_VERSION = 'v0.4.2'
export const DBT_LSP_REPO = 'j-clemons/dbt-language-server'
export const DBT_LSP_BINARY_NAME = 'dbt-language-server'

type DbtLspAsset = { name: string; sizeBytes: number; sha256: string }

// Why hashes: the download is executed as a child process, so a truncated or swapped
// file must never reach chmod +x. Hashes taken from the v0.4.2 assets on 2026-09-07.
const DBT_LSP_ASSETS: Record<string, DbtLspAsset> = {
  'darwin-arm64': {
    name: 'dbt-language-server-darwin-arm64',
    sizeBytes: 5_045_986,
    sha256: '18d1933e570e185edcb67304ae6b8ca073fbb908fd843bc619df6099a2b8d40f'
  },
  'darwin-x64': {
    name: 'dbt-language-server-darwin-amd64',
    sizeBytes: 5_178_784,
    sha256: '7500d03283348ed5a088ba560a5ba777689357d60912609b76df20aa1bea0720'
  },
  'linux-x64': {
    name: 'dbt-language-server-linux-amd64',
    sizeBytes: 5_217_210,
    sha256: '54b5db779462376c6dc1a382ea89da61bcf30f480374850e3dd7cf865d50cd58'
  }
}

export function dbtLspAssetFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): DbtLspAsset | null {
  return DBT_LSP_ASSETS[`${platform}-${arch}`] ?? null
}

export function dbtLspAssetUrl(asset: DbtLspAsset): string {
  return `https://github.com/${DBT_LSP_REPO}/releases/download/${DBT_LSP_VERSION}/${asset.name}`
}

export function dbtLspInstallRoot(userData: string): string {
  return join(userData, 'pod', DBT_LSP_BINARY_NAME)
}

export function dbtLspBinaryPath(userData: string, version = DBT_LSP_VERSION): string {
  return join(dbtLspInstallRoot(userData), version, DBT_LSP_BINARY_NAME)
}

export type DbtLspDownloadDeps = {
  userData: string
  fetch: (url: string) => Promise<Response>
  platform?: NodeJS.Platform
  arch?: string
  onProgress?: (message: string) => void
}

export class DbtLspUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbtLspUnavailableError'
  }
}

/** True when the pinned binary is on disk with the expected size. */
export function isDbtLspInstalled(
  userData: string,
  platform?: NodeJS.Platform,
  arch?: string
): boolean {
  const asset = dbtLspAssetFor(platform, arch)
  if (!asset) {
    return false
  }
  const file = dbtLspBinaryPath(userData)
  try {
    return statSync(file).size === asset.sizeBytes
  } catch {
    return false
  }
}

let inFlight: Promise<string> | null = null

/** Returns the binary path, downloading it first when missing. One download at a time. */
export function ensureDbtLspBinary(deps: DbtLspDownloadDeps): Promise<string> {
  inFlight ??= downloadDbtLsp(deps).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function downloadDbtLsp(deps: DbtLspDownloadDeps): Promise<string> {
  const asset = dbtLspAssetFor(deps.platform, deps.arch)
  if (!asset) {
    throw new DbtLspUnavailableError(
      `No dbt-language-server build for ${deps.platform ?? process.platform}-${deps.arch ?? process.arch}. Set its path in Settings > Analytics Tools.`
    )
  }
  const file = dbtLspBinaryPath(deps.userData)
  if (isDbtLspInstalled(deps.userData, deps.platform, deps.arch)) {
    return file
  }
  const dir = join(dbtLspInstallRoot(deps.userData), DBT_LSP_VERSION)
  mkdirSync(dir, { recursive: true })
  deps.onProgress?.(`Downloading ${asset.name} ${DBT_LSP_VERSION}`)
  const url = dbtLspAssetUrl(asset)
  let response: Response
  try {
    response = await deps.fetch(url)
  } catch (error) {
    throw new DbtLspUnavailableError(
      `Could not download dbt-language-server: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!response.ok) {
    throw new DbtLspUnavailableError(
      `Could not download dbt-language-server: ${url} answered ${response.status}`
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength !== asset.sizeBytes) {
    throw new DbtLspUnavailableError(
      `dbt-language-server download was ${bytes.byteLength} bytes, expected ${asset.sizeBytes}`
    )
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== asset.sha256) {
    throw new DbtLspUnavailableError(`dbt-language-server download failed its hash check`)
  }
  const partial = join(dir, `.${DBT_LSP_BINARY_NAME}.${process.pid}.part`)
  writeFileSync(partial, bytes)
  chmodSync(partial, 0o755)
  renameSync(partial, file)
  pruneOtherDbtLspVersions(deps.userData)
  return file
}

/** Removes every version directory except the pinned one. */
export function pruneOtherDbtLspVersions(userData: string): string[] {
  const root = dbtLspInstallRoot(userData)
  if (!existsSync(root)) {
    return []
  }
  const removed: string[] = []
  for (const entry of readdirSync(root)) {
    if (entry === DBT_LSP_VERSION) {
      continue
    }
    rmSync(join(root, entry), { recursive: true, force: true })
    removed.push(entry)
  }
  return removed
}
