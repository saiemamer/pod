import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  AE_DBT_SHOW_LIMIT_MAX,
  DEFAULT_AE_DBT_SETTINGS,
  normalizeAeDbtSettings,
  type AeDbtSettings
} from '../../../../shared/ae/dbt-settings-types'
import { SearchableSetting } from './SearchableSetting'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSwitchRow
} from './SettingsFormControls'
import { PodPathInput } from './PodPathInput'
import { getPodDbtSearchEntries } from './pod-tools-search'
import { translate } from '@/i18n/i18n'

type PodDbtPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}

/** Pod: dbt defaults shared by the results grid, lineage views and the dbt CLI. */
export function PodDbtPane({ settings, updateSettings }: PodDbtPaneProps): React.JSX.Element {
  const dbt = normalizeAeDbtSettings(settings.aeDbt)
  const [
    showLimit,
    target,
    profilesDir,
    projectDir,
    distribution,
    parseOnLoad,
    lineageDepth,
    lineageMaxNodes
  ] = getPodDbtSearchEntries()
  const save = (patch: Partial<AeDbtSettings>): void => {
    void updateSettings({ aeDbt: normalizeAeDbtSettings({ ...dbt, ...patch }) })
  }
  const savePath = (key: 'target' | 'profilesDir' | 'projectDir', value: string): void => {
    const next: AeDbtSettings = { ...dbt }
    if (value) {
      next[key] = value
    } else {
      delete next[key]
    }
    void updateSettings({ aeDbt: normalizeAeDbtSettings(next) })
  }
  return (
    <div className="flex flex-col gap-1">
      <SearchableSetting {...showLimit}>
        <NumberField
          label={showLimit.title}
          description={showLimit.description ?? ''}
          value={dbt.showLimit}
          defaultValue={DEFAULT_AE_DBT_SETTINGS.showLimit}
          min={1}
          max={AE_DBT_SHOW_LIMIT_MAX}
          integer
          onChange={(value) => save({ showLimit: value })}
          suffix={translate('pod.settings.dbt.rows', 'rows')}
        />
      </SearchableSetting>
      <SearchableSetting {...target}>
        <SettingsRow
          label={target.title}
          description={target.description}
          alignTop
          control={
            <div className="w-full max-w-md">
              <PodPathInput
                value={dbt.target}
                placeholder="dev"
                pick="file"
                onCommit={(value) => savePath('target', value)}
              />
            </div>
          }
        />
      </SearchableSetting>
      <SearchableSetting {...profilesDir}>
        <SettingsRow
          label={profilesDir.title}
          description={profilesDir.description}
          alignTop
          control={
            <div className="w-full max-w-md">
              <PodPathInput
                value={dbt.profilesDir}
                placeholder="~/.dbt"
                pick="directory"
                onCommit={(value) => savePath('profilesDir', value)}
              />
            </div>
          }
        />
      </SearchableSetting>
      <SearchableSetting {...projectDir}>
        <SettingsRow
          label={projectDir.title}
          description={projectDir.description}
          alignTop
          control={
            <div className="w-full max-w-md">
              <PodPathInput
                value={dbt.projectDir}
                placeholder={translate(
                  'pod.settings.dbt.projectDir.placeholder',
                  'nearest dbt_project.yml'
                )}
                pick="directory"
                onCommit={(value) => savePath('projectDir', value)}
              />
            </div>
          }
        />
      </SearchableSetting>
      <SearchableSetting {...distribution}>
        <SettingsRow
          label={distribution.title}
          description={distribution.description}
          control={
            <SettingsSegmentedControl
              value={dbt.distribution}
              ariaLabel={distribution.title}
              onChange={(value) => save({ distribution: value })}
              options={[
                {
                  value: 'core' as const,
                  label: translate('pod.settings.dbt.distribution.core', 'dbt Core')
                },
                {
                  value: 'fusion' as const,
                  label: translate('pod.settings.dbt.distribution.fusion', 'dbt Fusion')
                }
              ]}
            />
          }
        />
      </SearchableSetting>
      <SearchableSetting {...parseOnLoad}>
        <SettingsSwitchRow
          label={parseOnLoad.title}
          description={parseOnLoad.description}
          checked={dbt.parseOnLoad}
          onChange={() => save({ parseOnLoad: !dbt.parseOnLoad })}
        />
      </SearchableSetting>
      <SearchableSetting {...lineageDepth}>
        <NumberField
          label={lineageDepth.title}
          description={lineageDepth.description ?? ''}
          value={dbt.lineageDepth}
          defaultValue={DEFAULT_AE_DBT_SETTINGS.lineageDepth}
          min={1}
          max={20}
          integer
          onChange={(value) => save({ lineageDepth: value })}
        />
      </SearchableSetting>
      <SearchableSetting {...lineageMaxNodes}>
        <NumberField
          label={lineageMaxNodes.title}
          description={lineageMaxNodes.description ?? ''}
          value={dbt.lineageMaxNodes}
          defaultValue={DEFAULT_AE_DBT_SETTINGS.lineageMaxNodes}
          min={10}
          max={5000}
          integer
          onChange={(value) => save({ lineageMaxNodes: value })}
        />
      </SearchableSetting>
    </div>
  )
}
