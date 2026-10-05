import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PodCredentialService } from '../../shared/ae/pod-unreadable-types'
import { ORIGIN_MARKER_FILE } from './pod-credential-copy'

function serviceOfCredentialFile(relativePath: string): PodCredentialService | null {
  if (relativePath.startsWith('linear')) {
    return 'linear'
  }
  if (relativePath.startsWith('jira')) {
    return 'jira'
  }
  if (relativePath.startsWith('bitbucket')) {
    return 'bitbucket'
  }
  if (relativePath.startsWith('openai-speech')) {
    return 'openai-speech'
  }
  return relativePath.startsWith('minimax') ? 'minimax' : null
}

function hasTokenIn(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.enc'))
  } catch {
    return false
  }
}

/** Linear and Jira name token files by workspace or site, so any token there means "connected again". */
function hasReplacement(
  podCredentialDir: string,
  file: string,
  service: PodCredentialService
): boolean {
  if (existsSync(join(podCredentialDir, file))) {
    return true
  }
  if (service === 'linear') {
    return (
      existsSync(join(podCredentialDir, 'linear-token.enc')) ||
      hasTokenIn(join(podCredentialDir, 'linear-tokens'))
    )
  }
  return service === 'jira' && hasTokenIn(join(podCredentialDir, 'jira-tokens'))
}

/**
 * Services with a sealed file the first-start copy left in `~/.orca` and nothing in Pod's folder
 * to replace it yet. Saving the credential again writes the replacement, which clears the entry.
 */
export function credentialsLeftBehind(podCredentialDir: string): PodCredentialService[] {
  let leftSealed: unknown
  try {
    const marker: unknown = JSON.parse(
      readFileSync(join(podCredentialDir, ORIGIN_MARKER_FILE), 'utf8')
    )
    leftSealed =
      typeof marker === 'object' && marker !== null && 'leftSealed' in marker
        ? marker.leftSealed
        : null
  } catch {
    return []
  }
  if (!Array.isArray(leftSealed)) {
    return []
  }
  const services = new Set<PodCredentialService>()
  for (const file of leftSealed) {
    if (typeof file !== 'string') {
      continue
    }
    const service = serviceOfCredentialFile(file)
    if (service && !hasReplacement(podCredentialDir, file, service)) {
      services.add(service)
    }
  }
  return [...services]
}
