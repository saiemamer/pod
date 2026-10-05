import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILL_GUIDES } from './bundled-skill-guides'

describe('ae-initiative guide', () => {
  it('sends the main agent to the orca on PATH, not to an env variable a Pod terminal lacks', () => {
    const guide = BUNDLED_SKILL_GUIDES.find((entry) => entry.name === 'ae-initiative')
    // Why: Pod deletes ORCA_CLI_COMMAND for local terminals; only WSL and structured sessions set it.
    expect(guide?.markdown).not.toContain('ORCA_CLI_COMMAND')
    expect(guide?.markdown).toContain('Run every command below as plain `orca`')
  })
})
