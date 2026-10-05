import { describe, expect, it } from 'vitest'
import { GLOBAL_FLAGS } from '../args'
import { formatCommandHelp } from '../help'
import { DBT_COMMAND_SPECS } from './ae-dbt'
import { OMNI_COMMAND_SPECS } from './ae-omni'
import { AE_COMMAND_FLAG_HELP } from './ae-flag-help'

const specs = [...DBT_COMMAND_SPECS, ...OMNI_COMMAND_SPECS]

describe('orca dbt and orca omni flag help', () => {
  it('describes --model as a dbt model, not the agent launch flag', () => {
    const help = formatCommandHelp(DBT_COMMAND_SPECS.find((s) => s.path[1] === 'model-info')!)
    expect(help).toContain('--model <name>         dbt model name')
    expect(help).not.toContain('Provider model id')
  })

  it.each(specs.map((spec) => [spec.path.join(' '), spec] as const))(
    '%s describes each of its own flags',
    (command, spec) => {
      const ownFlags = spec.allowedFlags.filter((flag) => !GLOBAL_FLAGS.includes(flag))
      expect(Object.keys(AE_COMMAND_FLAG_HELP[command] ?? {}).sort()).toEqual(ownFlags.sort())
      const help = formatCommandHelp(spec)
      for (const flag of ownFlags) {
        expect(help).toContain(AE_COMMAND_FLAG_HELP[command][flag])
      }
    }
  )
})
