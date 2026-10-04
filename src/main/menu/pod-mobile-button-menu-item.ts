import { POD_SHOW_ORCA_CLOUD_FEATURES } from '../../shared/brand'
import { translateMain } from '../i18n/main-i18n'
import type { AppearanceMenuKey, AppearanceMenuState } from './register-app-menu'

/** Orca's "Show Orca Mobile Button" item, kept out of Pod's menu while the cloud flag is off. */
export function podMobileButtonMenuItems(
  appearance: AppearanceMenuState,
  onToggleAppearance: (key: AppearanceMenuKey) => void
): Electron.MenuItemConstructorOptions[] {
  if (!POD_SHOW_ORCA_CLOUD_FEATURES) {
    return []
  }
  return [
    {
      label: translateMain('menu.showMobileButton', 'Show Orca Mobile Button'),
      type: 'checkbox',
      checked: appearance.showMobileButton,
      click: () => onToggleAppearance('showMobileButton')
    }
  ]
}
