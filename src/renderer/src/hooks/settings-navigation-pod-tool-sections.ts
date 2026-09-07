import { Database, Wrench } from 'lucide-react'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { translate } from '@/i18n/i18n'
import {
  getPodDbtSearchEntries,
  getPodToolsSearchEntries
} from '../components/settings/pod-tools-search'

/** Pod: the "Analytics Tools" group in Settings. */
export function buildPodToolSettingsSections(): SettingsNavSection[] {
  return [
    {
      id: 'tools',
      title: translate('pod.settings.tools.title', 'Tools'),
      description: translate(
        'pod.settings.tools.description',
        'Where dbt, the Omni CLI and Python live on this machine.'
      ),
      icon: Wrench,
      searchEntries: getPodToolsSearchEntries(),
      group: 'tools'
    },
    {
      id: 'dbt',
      title: translate('pod.settings.dbt.title', 'dbt'),
      description: translate(
        'pod.settings.dbt.description',
        'Defaults for running models, previewing rows and drawing lineage.'
      ),
      icon: Database,
      searchEntries: getPodDbtSearchEntries(),
      group: 'tools'
    }
  ]
}
