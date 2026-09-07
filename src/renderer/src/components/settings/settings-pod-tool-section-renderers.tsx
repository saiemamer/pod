import { SettingsSection } from './SettingsSection'
import { PodToolsPane } from './PodToolsPane'
import { PodDbtPane } from './PodDbtPane'
import { translate } from '@/i18n/i18n'
import type { SettingsRenderContext } from './settings-render-context'

export function renderPodToolsSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="tools"
      title={translate('pod.settings.tools.title', 'Tools')}
      description={translate(
        'pod.settings.tools.description',
        'Where dbt, the Omni CLI and Python live on this machine.'
      )}
      searchEntries={navigation.getSectionSearchEntries('tools')}
    >
      {view.isSectionMounted('tools') ? (
        <PodToolsPane settings={model.settings} updateSettings={model.updateSettings} />
      ) : null}
    </SettingsSection>
  )
}

export function renderPodDbtSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="dbt"
      title={translate('pod.settings.dbt.title', 'dbt')}
      description={translate(
        'pod.settings.dbt.description',
        'Defaults for running models, previewing rows and drawing lineage.'
      )}
      searchEntries={navigation.getSectionSearchEntries('dbt')}
    >
      {view.isSectionMounted('dbt') ? (
        <PodDbtPane settings={model.settings} updateSettings={model.updateSettings} />
      ) : null}
    </SettingsSection>
  )
}
