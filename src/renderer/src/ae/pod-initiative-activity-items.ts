import { Target } from 'lucide-react'
import type { ActivityBarItem } from '@/components/right-sidebar/activity-bar-buttons'
import { translate } from '@/i18n/i18n'

/** Pod: the Initiative tab, shown for folder workspaces (initiative folders and domain main agents). */
export function podInitiativeActivityItems(): ActivityBarItem[] {
  return [
    {
      id: 'initiative',
      icon: Target,
      title: translate('pod.initiative.tab', 'Initiative'),
      shortcut: '',
      folderOnly: true
    }
  ]
}
