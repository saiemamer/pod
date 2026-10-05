import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { POD_CREDENTIAL_DIR_NAME } from '../../shared/brand'
import { classifyUnenvelopedCredential } from '../../shared/secret-at-rest-protection'
import { setPodCredentialDir } from './pod-credential-folder'

/** Every file the Linear, Jira, Bitbucket, OpenAI speech and MiniMax stores keep in `~/.orca`. */
const CREDENTIAL_FILES = [
  'linear-token.enc',
  'linear-viewer.json',
  'linear-workspaces.json',
  'jira-sites.json',
  'bitbucket-credential.json',
  'bitbucket-credential.enc',
  'openai-speech-token.enc',
  'minimax-api-key.enc',
  'minimax-session-cookie.enc'
]
const CREDENTIAL_TOKEN_DIRS = ['linear-tokens', 'jira-tokens']
export const ORIGIN_MARKER_FILE = 'pod-credentials-origin.json'
const STAGING_SUFFIX = '.pod-copying'
const MINIMAX_ENVELOPE = /^orca-minimax-(?:api-key|cookie):v1:(encrypted|plaintext):/

export type PodCredentialCopyResult =
  | { kind: 'already-copied' }
  | { kind: 'copied'; copied: string[]; leftSealed: string[] }

/** Packaged Pod only, before `ready`: copy Orca's unsealed credential files once, then use `~/.pod`. */
export function applyPodCredentialFolder(homeDir: string): void {
  const target = join(homeDir, POD_CREDENTIAL_DIR_NAME)
  setPodCredentialDir(target)
  try {
    const result = copyOrcaCredentialsOnce({ sourceDir: join(homeDir, '.orca'), targetDir: target })
    if (result.kind === 'copied') {
      console.log(
        `[pod-credentials] Copied ${result.copied.length} credential files into ${target}; left ${result.leftSealed.length} sealed with Orca's key`
      )
    }
  } catch (error) {
    // Why: a failed copy costs only retyping; the next start retries it without overwriting.
    console.warn('[pod-credentials] Could not copy credential files from ~/.orca:', error)
  }
}

/**
 * Sealed files stay behind: Pod's key cannot open what Orca's key sealed. Never changes the
 * source, never overwrites a file already in the target, and the marker written last makes a
 * finished copy run once; an interrupted one runs again from the start.
 */
export function copyOrcaCredentialsOnce(options: {
  sourceDir: string
  targetDir: string
  now?: Date
}): PodCredentialCopyResult {
  const { sourceDir, targetDir } = options
  if (existsSync(join(targetDir, ORIGIN_MARKER_FILE))) {
    return { kind: 'already-copied' }
  }
  mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  removeStaleStaging(targetDir)
  const copied: string[] = []
  const leftSealed: string[] = []
  for (const relativePath of listCredentialFiles(sourceDir)) {
    const raw = readFileSync(join(sourceDir, relativePath))
    if (raw.length === 0) {
      continue
    }
    if (isSealedCredentialFile(raw)) {
      leftSealed.push(relativePath)
    } else if (copyIfAbsent(raw, join(targetDir, relativePath))) {
      copied.push(relativePath)
    }
  }
  const origin = {
    source: sourceDir,
    copiedAt: (options.now ?? new Date()).toISOString(),
    copied,
    leftSealed
  }
  const markerPath = join(targetDir, ORIGIN_MARKER_FILE)
  writeFileSync(`${markerPath}${STAGING_SUFFIX}`, `${JSON.stringify(origin, null, 2)}\n`, {
    mode: 0o600
  })
  renameSync(`${markerPath}${STAGING_SUFFIX}`, markerPath)
  return { kind: 'copied', copied, leftSealed }
}

function listCredentialFiles(sourceDir: string): string[] {
  const files = [...CREDENTIAL_FILES]
  for (const dir of CREDENTIAL_TOKEN_DIRS) {
    if (existsSync(join(sourceDir, dir))) {
      for (const name of readdirSync(join(sourceDir, dir)).sort()) {
        if (name.endsWith('.enc')) {
          files.push(join(dir, name))
        }
      }
    }
  }
  return files.filter((file) => {
    try {
      return statSync(join(sourceDir, file)).isFile()
    } catch {
      return false
    }
  })
}

/** Whether a stored credential needs a Keychain key to read, judged from its bytes alone. */
export function isSealedCredentialFile(raw: Buffer): boolean {
  const text = raw.toString('utf8')
  const envelope = MINIMAX_ENVELOPE.exec(text)
  if (envelope) {
    return envelope[1] === 'encrypted'
  }
  if (isLegacyOpenAiKeyWrapper(text)) {
    return true
  }
  return classifyUnenvelopedCredential(raw) === 'sealed'
}

/** The speech store's old JSON wrapper holds base64 ciphertext, so it reads as printable text. */
function isLegacyOpenAiKeyWrapper(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'encryptedKeyBase64' in parsed &&
      typeof parsed.encryptedKeyBase64 === 'string'
    )
  } catch {
    return false
  }
}

/** A hard link publishes the whole file or nothing, and fails rather than replace one. */
function copyIfAbsent(raw: Buffer, destination: string): boolean {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const staging = `${destination}.${process.pid}${STAGING_SUFFIX}`
  writeFileSync(staging, raw, { mode: 0o600 })
  try {
    linkSync(staging, destination)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false
    }
    throw error
  } finally {
    rmSync(staging, { force: true })
  }
}

function removeStaleStaging(targetDir: string): void {
  for (const dir of [targetDir, ...CREDENTIAL_TOKEN_DIRS.map((name) => join(targetDir, name))]) {
    if (!existsSync(dir)) {
      continue
    }
    for (const name of readdirSync(dir)) {
      if (name.endsWith(STAGING_SUFFIX)) {
        rmSync(join(dir, name), { force: true })
      }
    }
  }
}
