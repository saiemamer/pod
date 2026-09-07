import { describe, expect, it } from 'vitest'
import { relativeToRoot, worktreeRootOf } from './pod-dbt-paths'

describe('worktree path arithmetic', () => {
  it('derives the root from an open file and its relative path', () => {
    expect(worktreeRootOf('/w/repo/models/marts/orders.sql', 'models/marts/orders.sql')).toBe(
      '/w/repo'
    )
    expect(worktreeRootOf('/w/repo/models/orders.sql', './models/orders.sql')).toBe('/w/repo')
    expect(worktreeRootOf('/w/repo/models/orders.sql', 'other.sql')).toBeNull()
    expect(worktreeRootOf('/w/repo/x.sql', '')).toBeNull()
  })

  it('makes the target relative when it lives under the root', () => {
    expect(relativeToRoot('/w/repo', '/w/repo/models/stg_orders.sql')).toBe('models/stg_orders.sql')
    expect(relativeToRoot('/w/repo', '/elsewhere/x.sql')).toBe('/elsewhere/x.sql')
    expect(relativeToRoot(null, '/w/repo/x.sql')).toBe('/w/repo/x.sql')
  })
})
