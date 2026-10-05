import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PodStartNoticeContent } from '../../shared/ae/pod-unreadable-types'

/** In Pod's data folder; delete it to see the notice again. */
export const START_NOTICE_SHOWN_FILE = 'pod-start-notice-shown.json'

export type PodStartNoticeSources = {
  userDataDir: string
  credentials: () => PodStartNoticeContent['credentials']
  domainSecrets: () => PodStartNoticeContent['domainSecrets']
  settings: () => PodStartNoticeContent['settings']
  now?: Date
}

/**
 * Pod: the values the one-time start notice lists, once. Returns null when it was shown before
 * or when nothing is unreadable; only a non-empty answer records it as shown, so a start that
 * finds nothing leaves the notice for the first start that does.
 */
export function takePodStartNotice(sources: PodStartNoticeSources): PodStartNoticeContent | null {
  const shownFile = join(sources.userDataDir, START_NOTICE_SHOWN_FILE)
  if (existsSync(shownFile)) {
    return null
  }
  const content: PodStartNoticeContent = {
    credentials: sources.credentials(),
    domainSecrets: sources.domainSecrets().filter((domain) => domain.secretNames.length > 0),
    settings: sources.settings()
  }
  if (
    content.credentials.length === 0 &&
    content.domainSecrets.length === 0 &&
    content.settings.length === 0
  ) {
    return null
  }
  try {
    writeFileSync(
      shownFile,
      `${JSON.stringify({ shownAt: (sources.now ?? new Date()).toISOString() })}\n`
    )
  } catch (error) {
    // Why still shown: the Settings screens ask again regardless; a notice seen twice beats none.
    console.warn('[pod-start-notice] Could not record the notice as shown:', error)
  }
  return content
}
