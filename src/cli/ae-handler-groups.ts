import type { HandlerGroup } from './handler-group-manifest'

// Why split out: keeps Orca's handler-group-manifest.ts under its line limit with one Pod line.
export const AE_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'domain',
    keys: ['domain list', 'domain show', 'domain initiative-update'],
    load: async () => (await import('./handlers/ae-domain.js')).DOMAIN_HANDLERS
  },
  {
    name: 'dbt',
    keys: [
      'dbt project',
      'dbt list-models',
      'dbt model-info',
      'dbt lineage',
      'dbt column-lineage',
      'dbt show',
      'dbt compile',
      'dbt parse'
    ],
    load: async () => (await import('./handlers/ae-dbt.js')).DBT_HANDLERS
  },
  {
    name: 'omni',
    keys: ['omni branch', 'omni validate', 'omni commit'],
    load: async () => (await import('./handlers/ae-omni.js')).OMNI_HANDLERS
  }
]
