import { describe, expect, it } from 'vitest'
import { rebrandProductName } from './brand-text'

describe('rebrandProductName', () => {
  it('renames the product in ordinary UI copy', () => {
    expect(rebrandProductName('Orca v0.1.5 is ready.')).toBe('Pod v0.1.5 is ready.')
    expect(rebrandProductName("Orca's graphics process crashed.")).toBe(
      "Pod's graphics process crashed."
    )
    expect(rebrandProductName('ORCA')).toBe('POD')
    expect(rebrandProductName('Restarting Orca...')).toBe('Restarting Pod...')
  })

  it('leaves Orca-operated services, apps and the star nag alone', () => {
    expect(rebrandProductName('Open Orca Mobile, tap')).toBe('Open Orca Mobile, tap')
    expect(rebrandProductName('Orca Relay is in beta.')).toBe('Orca Relay is in beta.')
    expect(rebrandProductName('Sign in to Orca')).toBe('Sign in to Orca')
    expect(rebrandProductName('Star Orca on GitHub')).toBe('Star Orca on GitHub')
    expect(rebrandProductName('Show Orca Mobile Button in Orca')).toBe(
      'Show Orca Mobile Button in Pod'
    )
  })

  it('does not touch lowercase command names, URLs or unrelated text', () => {
    expect(rebrandProductName('run orca worktree create')).toBe('run orca worktree create')
    expect(rebrandProductName('https://onorca.dev/docs')).toBe('https://onorca.dev/docs')
    expect(rebrandProductName('Orcas are whales')).toBe('Orcas are whales')
    expect(rebrandProductName('plain text')).toBe('plain text')
  })
})
