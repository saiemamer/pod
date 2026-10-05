import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { SettingsNavTarget } from '@/lib/settings-navigation-types'
import {
  POD_CREDENTIAL_SERVICE_LABELS,
  POD_UNREADABLE_SETTING_LABELS,
  type PodCredentialService,
  type PodStartNoticeContent,
  type PodUnreadableSetting
} from '../../../shared/ae/pod-unreadable-types'

export const POD_START_NOTICE_TOAST_ID = 'pod-start-notice'

export type PodStartNoticeTarget =
  | { kind: 'settings'; pane: SettingsNavTarget; screen: string }
  | { kind: 'domain'; domainId: string; domainName: string }

export type PodStartNoticeItem = { text: string; target: PodStartNoticeTarget }

const CREDENTIAL_PANES: Record<PodCredentialService, SettingsNavTarget> = {
  linear: 'integrations',
  jira: 'integrations',
  bitbucket: 'integrations',
  'openai-speech': 'voice',
  minimax: 'accounts'
}

const SETTING_PANES: Record<PodUnreadableSetting, SettingsNavTarget> = {
  opencodeGoApiKey: 'accounts',
  opencodeSessionCookie: 'accounts',
  httpProxyUrl: 'advanced',
  browserKagiSessionLink: 'browser'
}

const SCREEN_NAMES: Partial<Record<SettingsNavTarget, string>> = {
  integrations: 'Integrations',
  voice: 'Voice',
  accounts: 'Accounts',
  advanced: 'Advanced',
  browser: 'Browser'
}

function settingsTarget(pane: SettingsNavTarget): PodStartNoticeTarget {
  return { kind: 'settings', pane, screen: SCREEN_NAMES[pane] ?? pane }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One line per unreadable value, in the order the brief names them: credentials, domain secrets, settings. */
export function podStartNoticeItems(content: PodStartNoticeContent): PodStartNoticeItem[] {
  return [
    ...content.credentials.map((service) => ({
      text: translate('pod.startNotice.credential', '{{value0}} credentials', {
        value0: POD_CREDENTIAL_SERVICE_LABELS[service]
      }),
      target: settingsTarget(CREDENTIAL_PANES[service])
    })),
    ...content.domainSecrets.map((domain) => ({
      text: translate('pod.startNotice.domainSecrets', '{{value0}} in the {{value1}} domain', {
        value0: domain.secretNames.join(', '),
        value1: domain.domainName
      }),
      target: { kind: 'domain' as const, domainId: domain.domainId, domainName: domain.domainName }
    })),
    ...content.settings.map((setting) => ({
      text: capitalized(POD_UNREADABLE_SETTING_LABELS[setting]),
      target: settingsTarget(SETTING_PANES[setting])
    }))
  ]
}

function buttonLabel(target: PodStartNoticeTarget): string {
  return target.kind === 'domain'
    ? translate('pod.startNotice.openDomain', 'Open Domain settings')
    : translate('pod.startNotice.openSettings', 'Open {{value0}} settings', {
        value0: target.screen
      })
}

/**
 * Pod: once, at the first start that finds values Pod cannot read, lists them and opens the screen
 * where the first is entered. Main records it as shown when it answers, so it never comes back.
 */
export function PodStartNoticeHost(): null {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openAeDialog = useAppStore((s) => s.openAeDialog)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const setSidebarBody = useAppStore((s) => s.setSidebarBody)

  useEffect(() => {
    const startNotice = typeof window !== 'undefined' ? window.api?.ae?.startNotice : undefined
    if (!startNotice) {
      return
    }
    // Why no cancel on unmount: main answers once, so a dropped answer would lose the notice for good.
    void startNotice
      .take()
      .then((content) => {
        const items = content ? podStartNoticeItems(content) : []
        const first = items[0]
        if (!first) {
          return
        }
        toast.warning(translate('pod.startNotice.title', 'Pod could not read some saved values'), {
          id: POD_START_NOTICE_TOAST_ID,
          description: (
            <div className="flex flex-col gap-1">
              <span>
                {translate(
                  'pod.startNotice.description',
                  'Orca or an earlier Pod saved them with a key this Pod no longer uses. Enter each one again; its Settings screen asks until you do.'
                )}
              </span>
              <ul className="list-disc pl-4">
                {items.map((item) => (
                  <li key={item.text}>{item.text}</li>
                ))}
              </ul>
            </div>
          ),
          duration: Infinity,
          action: {
            label: buttonLabel(first.target),
            onClick: () => {
              if (first.target.kind === 'domain') {
                // Why: Domain settings mounts from the projects list, which a closed sidebar or the Agents view unmounts.
                setSidebarOpen(true)
                setSidebarBody('workspaces')
                openAeDialog({
                  kind: 'domain-settings',
                  groupId: first.target.domainId,
                  label: first.target.domainName
                })
                return
              }
              openSettingsPage()
              openSettingsTarget({ pane: first.target.pane, repoId: null })
            }
          }
        })
      })
      .catch(() => {})
  }, [openSettingsPage, openSettingsTarget, openAeDialog, setSidebarOpen, setSidebarBody])

  return null
}
