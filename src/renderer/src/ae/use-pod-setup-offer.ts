import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { setupInitialForRepo } from './PodSetupButton'

/**
 * Pod: a project added the ordinary way that holds a dbt project or an Omni model, and sits in
 * no domain, gets a one-click offer of first setup for that repo. Only repos added after the
 * sidebar mounted count, so a restart does not offer every old repo again.
 */
export function usePodSetupOffer(): void {
  const repos = useAppStore((s) => s.repos)
  const openAeDialog = useAppStore((s) => s.openAeDialog)
  const mountedAt = useRef<number | null>(null)
  const offered = useRef(new Set<string>())
  useEffect(() => {
    const since = (mountedAt.current ??= Date.now())
    for (const repo of repos) {
      if (repo.addedAt < since || repo.connectionId || offered.current.has(repo.id)) {
        continue
      }
      offered.current.add(repo.id)
      void window.api.ae.setup
        .repoInfo({ path: repo.path })
        .then((info) => {
          if (!info || info.domainId || info.role === 'other') {
            return
          }
          toast(
            info.role === 'dbt'
              ? translate('pod.setup.offerDbt', '{{name}} holds a dbt project', {
                  name: repo.displayName
                })
              : translate('pod.setup.offerOmni', '{{name}} holds an Omni model', {
                  name: repo.displayName
                }),
            {
              description: translate(
                'pod.setup.offerDescription',
                'Pod can find dbt, your profile and target, and set up the repo for you.'
              ),
              duration: 15_000,
              action: {
                label: translate('pod.setup.offerAction', 'Set up'),
                onClick: () => openAeDialog({ kind: 'setup', initial: setupInitialForRepo(info) })
              }
            }
          )
        })
        .catch(() => undefined)
    }
  }, [repos, openAeDialog])
}
