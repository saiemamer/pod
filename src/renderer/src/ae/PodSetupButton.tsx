import { useEffect, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { AeSetupDialog } from './AeSetupDialog'

/** Pod: opens first setup. `whenNoDomain` hides it once a domain exists (the landing page). */
export function PodSetupButton({
  whenNoDomain = false
}: {
  whenNoDomain?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
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
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wand2 className="size-3.5" />
        {translate('pod.setup.open', 'Set up from repos')}
      </Button>
      {open ? <AeSetupDialog onOpenChange={setOpen} /> : null}
    </>
  )
}
