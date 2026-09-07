import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Pod: domain entries in the project group menu. The dialogs mount in PodProjectGroupDialogHost. */
export function PodProjectGroupMenuItems({
  groupId,
  label
}: {
  groupId: string
  label: string
}): React.JSX.Element {
  const openAeDialog = useAppStore((s) => s.openAeDialog)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openAeDialog({ kind: 'domain-settings', groupId, label })}>
        {translate('pod.domain.menu.settings', 'Domain settings…')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openAeDialog({ kind: 'new-initiative', groupId, label })}>
        {translate('pod.domain.menu.newInitiative', 'New initiative…')}
      </DropdownMenuItem>
    </>
  )
}
