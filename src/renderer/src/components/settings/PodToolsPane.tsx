import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { AeToolCmdOverrides } from '../../../../shared/ae/dbt-settings-types'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'
import { PodPathInput } from './PodPathInput'
import { getPodToolsSearchEntries } from './pod-tools-search'

type PodToolsPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}

const TOOLS: { key: keyof AeToolCmdOverrides; placeholder: string }[] = [
  { key: 'dbt', placeholder: 'dbt' },
  { key: 'omni', placeholder: 'omni' },
  { key: 'python', placeholder: 'python3' },
  { key: 'dbtLsp', placeholder: 'dbt-language-server' }
]

/** Pod: where the analytics tools live. Empty means the agent's PATH decides. */
export function PodToolsPane({ settings, updateSettings }: PodToolsPaneProps): React.JSX.Element {
  const overrides = settings.toolCmdOverrides ?? {}
  const entries = getPodToolsSearchEntries()
  const setTool = (key: keyof AeToolCmdOverrides, value: string): void => {
    const next: AeToolCmdOverrides = { ...overrides }
    if (value) {
      next[key] = value
    } else {
      delete next[key]
    }
    // Why: nested settings objects replace rather than merge on save.
    void updateSettings({ toolCmdOverrides: next })
  }
  return (
    <div className="flex flex-col gap-1">
      {TOOLS.map((tool, index) => {
        const entry = entries[index]
        return (
          <SearchableSetting
            key={tool.key}
            title={entry.title}
            description={entry.description}
            keywords={entry.keywords}
          >
            <SettingsRow
              label={entry.title}
              description={entry.description}
              alignTop
              control={
                <div className="w-full max-w-md">
                  <PodPathInput
                    value={overrides[tool.key]}
                    placeholder={tool.placeholder}
                    pick="file"
                    onCommit={(value) => setTool(tool.key, value)}
                  />
                </div>
              }
            />
          </SearchableSetting>
        )
      })}
    </div>
  )
}
