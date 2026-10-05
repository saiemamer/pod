import { useEffect, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { AeSetupInitial, AeSetupRepoInfo } from '../../../shared/ae/setup-types'
import { AeSetupDialog } from './AeSetupDialog'

/**
 * Pod: opens first setup. `whenNoDomain` is the landing page: the button asks for the dbt repo
 * folder straight away and hides once a domain exists.
 */
export function PodSetupButton({
  whenNoDomain = false
}: {
  whenNoDomain?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState<AeSetupInitial | null>(null)
  const aeLoaded = useAppStore((s) => s.aeLoaded)
  const hasDomain = useAppStore((s) => Object.keys(s.aeDomains).length > 0)
  const fetchAeDomains = useAppStore((s) => s.fetchAeDomains)
  useEffect(() => {
    if (!aeLoaded) {
      void fetchAeDomains()
    }
  }, [aeLoaded, fetchAeDomains])
  if (whenNoDomain && (!aeLoaded || hasDomain)) {
    return null
  }
  const start = async (): Promise<void> => {
    if (!whenNoDomain) {
      setOpen({})
      return
    }
    const picked = await window.api.shell.pickDirectory({})
    if (picked) {
      setOpen({ dbtRepoPath: picked })
    }
  }
  return (
    <>
      <Button
        type="button"
        variant={whenNoDomain ? 'default' : 'outline'}
        size="sm"
        onClick={() => void start()}
      >
        <Wand2 className="size-3.5" />
        {whenNoDomain
          ? translate('pod.setup.chooseRepo', 'Choose your dbt repo')
          : translate('pod.setup.open', 'Set up from repos')}
      </Button>
      {open ? <AeSetupDialog initial={open} onOpenChange={() => setOpen(null)} /> : null}
    </>
  )
}

/** The repo handed to setup: a dbt repo starts at once; an Omni repo waits for its dbt repo. */
export function setupInitialForRepo(info: AeSetupRepoInfo): AeSetupInitial {
  return info.role === 'omni' ? { omniRepoPath: info.repoPath } : { dbtRepoPath: info.repoPath }
}

/** Plain words and one button where a panel finds its repo in no domain. */
export function PodSetupThisRepo({
  path,
  message
}: {
  path: string
  message: string
}): React.JSX.Element | null {
  const [info, setInfo] = useState<AeSetupRepoInfo | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.api.ae.setup.repoInfo({ path }).then(
      (next) => !cancelled && setInfo(next),
      () => !cancelled && setInfo(null)
    )
    return () => {
      cancelled = true
    }
  }, [path])
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="pod-setup-this-repo">
      <span>{message}</span>
      {info && !info.domainId ? (
        <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)}>
          <Wand2 className="size-3" />
          {translate('pod.setup.thisRepo', 'Set up this repo')}
        </Button>
      ) : null}
      {open && info ? (
        <AeSetupDialog initial={setupInitialForRepo(info)} onOpenChange={() => setOpen(false)} />
      ) : null}
    </span>
  )
}
