import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  POD_CREDENTIAL_SERVICE_LABELS,
  type PodCredentialService
} from '../../../shared/ae/pod-unreadable-types'

// Why poll: the connect dialogs save through their own stores, and the check is a few file stats.
const RECHECK_MS = 4000

/**
 * Pod: asks again for a credential the first start left in Orca's `~/.orca`, sealed with a key Pod
 * no longer uses. Shown above the place the person enters it; gone once a new one is saved.
 */
export function PodCredentialsLeftBehindNotice({
  services
}: {
  services: PodCredentialService[]
}): React.JSX.Element | null {
  const [leftBehind, setLeftBehind] = useState<PodCredentialService[]>([])
  const servicesKey = services.join(',')

  useEffect(() => {
    const credentials = typeof window !== 'undefined' ? window.api?.ae?.credentials : undefined
    if (!credentials) {
      return
    }
    let cancelled = false
    const check = (): void => {
      void credentials
        .leftBehind()
        .then((found) => {
          if (!cancelled) {
            setLeftBehind(found)
          }
        })
        .catch(() => {})
    }
    check()
    const timer = window.setInterval(check, RECHECK_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [servicesKey])

  const shown = services.filter((service) => leftBehind.includes(service))
  if (shown.length === 0) {
    return null
  }
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground"
    >
      {translate(
        'pod.credentials.leftBehind',
        'Pod could not bring over your saved {{value0}} credentials. They were saved by Orca or by an earlier Pod, with a key this Pod no longer uses. Connect {{value0}} again below; the old copy stays where it was.',
        { value0: shown.map((service) => POD_CREDENTIAL_SERVICE_LABELS[service]).join(', ') }
      )}
    </p>
  )
}
