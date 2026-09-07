import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SettingsSearchEntry } from './settings-search'

/** Pod: search entries double as the row copy, so titles and descriptions live once. */
export const getPodToolsSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('pod.settings.tools.dbt.title', 'dbt command'),
    description: translate(
      'pod.settings.tools.dbt.description',
      'Path to the dbt binary Pod and its agents run. Leave empty to use the one on PATH.'
    ),
    keywords: ['dbt', 'binary', 'path', 'venv', 'core', 'fusion']
  },
  {
    title: translate('pod.settings.tools.omni.title', 'omni command'),
    description: translate(
      'pod.settings.tools.omni.description',
      'Path to the Omni CLI used for model branches, validation and commits.'
    ),
    keywords: ['omni', 'binary', 'path', 'cli']
  },
  {
    title: translate('pod.settings.tools.python.title', 'python command'),
    description: translate(
      'pod.settings.tools.python.description',
      'Python with sqlglot installed, used for column-level lineage. Leave empty to use python3 on PATH.'
    ),
    keywords: ['python', 'sqlglot', 'lineage', 'path']
  },
  {
    title: translate('pod.settings.tools.dbtLsp.title', 'dbt-language-server command'),
    description: translate(
      'pod.settings.tools.dbtLsp.description',
      'Path to dbt-language-server for completion and go-to-definition in models. Leave empty and Pod downloads the pinned release.'
    ),
    keywords: ['dbt', 'lsp', 'language server', 'completion', 'definition', 'path']
  }
])

export const getPodDbtSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('pod.settings.dbt.showLimit.title', 'Row limit for dbt show'),
    description: translate(
      'pod.settings.dbt.showLimit.description',
      'Maximum rows fetched when you run a model with Cmd+Enter. BigQuery bills per query, so keep it bounded.'
    ),
    keywords: ['dbt', 'show', 'limit', 'rows', 'preview', 'bigquery']
  },
  {
    title: translate('pod.settings.dbt.target.title', 'Default target'),
    description: translate(
      'pod.settings.dbt.target.description',
      'Passed as --target. Empty uses the profile default. A domain can override it.'
    ),
    keywords: ['dbt', 'target', 'dev', 'prod', 'profile']
  },
  {
    title: translate('pod.settings.dbt.profilesDir.title', 'Profiles directory'),
    description: translate(
      'pod.settings.dbt.profilesDir.description',
      'Passed as --profiles-dir. Empty lets Pod look in the repo (local_profiles, profiles, .dbt) and then dbt decide.'
    ),
    keywords: ['dbt', 'profiles', 'profiles.yml', 'directory']
  },
  {
    title: translate('pod.settings.dbt.projectDir.title', 'Project directory'),
    description: translate(
      'pod.settings.dbt.projectDir.description',
      'Where dbt_project.yml lives when it is not the nearest one above the open file.'
    ),
    keywords: ['dbt', 'project', 'dbt_project.yml', 'directory']
  },
  {
    title: translate('pod.settings.dbt.distribution.title', 'Distribution'),
    description: translate(
      'pod.settings.dbt.distribution.description',
      'dbt Core uses a separate language server; dbt Fusion ships its own.'
    ),
    keywords: ['dbt', 'core', 'fusion', 'distribution', 'lsp']
  },
  {
    title: translate('pod.settings.dbt.parseOnLoad.title', 'Parse the project on open'),
    description: translate(
      'pod.settings.dbt.parseOnLoad.description',
      'Run dbt parse once per project per session so lineage and navigation are current.'
    ),
    keywords: ['dbt', 'parse', 'manifest', 'startup']
  },
  {
    title: translate('pod.settings.dbt.lineageDepth.title', 'Lineage depth'),
    description: translate(
      'pod.settings.dbt.lineageDepth.description',
      'How many upstream and downstream levels the lineage canvas expands by default.'
    ),
    keywords: ['dbt', 'lineage', 'depth', 'upstream', 'downstream']
  },
  {
    title: translate('pod.settings.dbt.lineageMaxNodes.title', 'Lineage node cap'),
    description: translate(
      'pod.settings.dbt.lineageMaxNodes.description',
      'Stop expanding the lineage canvas past this many models so large projects stay responsive.'
    ),
    keywords: ['dbt', 'lineage', 'nodes', 'limit', 'performance']
  },
  {
    title: translate('pod.settings.dbt.lspEnabled.title', 'Language server'),
    description: translate(
      'pod.settings.dbt.lspEnabled.description',
      'Run dbt-language-server for Jinja SQL editors: completion for ref(), source() and macros, hover, go-to-definition, and diagnostics with dbt Fusion.'
    ),
    keywords: ['dbt', 'lsp', 'language server', 'completion', 'hover', 'definition']
  }
])
