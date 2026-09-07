import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

/** Pod: domains are folders of repos with roles; agents read them to know where dbt and Omni live. */
export const DOMAIN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['domain', 'list'],
    summary: 'List Pod domains (project groups with repo roles) and their initiatives',
    usage: 'orca domain list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca domain list --json']
  },
  {
    path: ['domain', 'show'],
    summary: 'Show one Pod domain: repos with roles, env variable names, dbt defaults, initiatives',
    usage: 'orca domain show --domain <id|name> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'domain'],
    examples: ['orca domain show --domain MEX --json'],
    notes: ['Secret values are never printed; only their names.']
  }
]
