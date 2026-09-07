import { useAppStore } from '@/store'
import { DomainSettingsDialog } from './DomainSettingsDialog'
import { NewInitiativeDialog } from './NewInitiativeDialog'

/** Pod: mounts the dialog the project group menu asked for. Keyed by group so a fresh form seeds per open. */
export function PodProjectGroupDialogHost(): React.JSX.Element | null {
  const aeDialog = useAppStore((s) => s.aeDialog)
  const closeAeDialog = useAppStore((s) => s.closeAeDialog)
  if (!aeDialog) {
    return null
  }
  const onOpenChange = (open: boolean): void => {
    if (!open) {
      closeAeDialog()
    }
  }
  if (aeDialog.kind === 'domain-settings') {
    return (
      <DomainSettingsDialog
        key={aeDialog.groupId}
        groupId={aeDialog.groupId}
        label={aeDialog.label}
        onOpenChange={onOpenChange}
      />
    )
  }
  return (
    <NewInitiativeDialog
      key={aeDialog.groupId}
      groupId={aeDialog.groupId}
      label={aeDialog.label}
      onOpenChange={onOpenChange}
    />
  )
}
