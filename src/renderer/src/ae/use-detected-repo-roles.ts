import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { AeDomainRepo } from '../../../shared/ae/domain-types'

/**
 * Pod: the role each repo's checkout suggests, read once per dialog. A group with no domain yet,
 * or a repo that joined after the last save, has no saved role; this keeps dbt from showing as other.
 * Null until the read finishes.
 */
export function useDetectedRepoRoles(groupId: string): AeDomainRepo[] | null {
  const detectAeRepoRoles = useAppStore((s) => s.detectAeRepoRoles)
  const [detected, setDetected] = useState<AeDomainRepo[] | null>(null)
  useEffect(() => {
    let cancelled = false
    detectAeRepoRoles(groupId).then(
      (roles) => !cancelled && setDetected(roles),
      () => !cancelled && setDetected([])
    )
    return () => {
      cancelled = true
    }
  }, [detectAeRepoRoles, groupId])
  return detected
}
