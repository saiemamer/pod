import type { KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

/** Pod: dbt actions in Jinja SQL editors. Rebindable in Settings > Keybindings like every other action. */
export const KEYBINDING_DEFINITION_AE: readonly KeybindingDefinition[] = [
  {
    id: 'dbt.runSelection',
    title: 'dbt: Run Selection or Model',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: ['dbt', 'sql', 'query', 'run', 'show', 'rows', 'pod'],
    defaultBindings: platformBindings(['Mod+Enter'])
  },
  {
    id: 'dbt.compileSelection',
    title: 'dbt: Compile Selection or Model',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: ['dbt', 'sql', 'compile', 'jinja', 'pod'],
    defaultBindings: platformBindings(['Mod+Shift+Enter'])
  },
  {
    id: 'dbt.showLineage',
    title: 'dbt: Show Lineage',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: ['dbt', 'lineage', 'graph', 'columns', 'upstream', 'downstream', 'pod'],
    defaultBindings: platformBindings(['Mod+Alt+L'])
  }
]
