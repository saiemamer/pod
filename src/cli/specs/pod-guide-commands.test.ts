import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILL_GUIDES } from '../bundled-skill-guides'
import { COMMAND_SPECS } from './index'

// Pod: the upstream flag check skips an invocation no spec matches, so a guide could name a
// subcommand that does not exist (`orca orchestration worker-done`) and still pass.
const CLI_INVOCATION = /(?:^|[\s`(])(?:orca|orca-dev|ORCA)\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/g

// Groups whose commands are `<group> <verb>`; a word after a one-word command is an operand.
const GROUPS = new Set(
  COMMAND_SPECS.filter((spec) => spec.path.length > 1).map((spec) => spec.path[0])
)
const COMMANDS = new Set(COMMAND_SPECS.map((spec) => spec.path.slice(0, 2).join(' ')))

describe('bundled skill guides', () => {
  it('name only orca subcommands the CLI has', () => {
    const unknown: string[] = []
    let checked = 0
    for (const guide of BUNDLED_SKILL_GUIDES) {
      for (const match of guide.fullMarkdown.matchAll(CLI_INVOCATION)) {
        if (!GROUPS.has(match[1])) {
          continue
        }
        checked += 1
        if (!COMMANDS.has(`${match[1]} ${match[2]}`)) {
          unknown.push(`${guide.name}: orca ${match[1]} ${match[2]}`)
        }
      }
    }
    // Why: the check is vacuous if the pattern stops matching guide prose.
    expect(checked).toBeGreaterThan(50)
    expect(unknown).toEqual([])
  })
})
