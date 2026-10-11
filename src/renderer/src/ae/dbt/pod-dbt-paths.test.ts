import { describe, expect, it } from 'vitest'
import { relativeInsideRoot, worktreeRootOf } from './pod-dbt-paths'

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
    expect(relativeInsideRoot('/w/repo', '/w/repo/models/stg_orders.sql')).toBe(
      'models/stg_orders.sql'
    )
    expect(relativeInsideRoot('/w/repo', '/w/repo/dbt_packages/utils/macros/x.sql')).toBe(
      'dbt_packages/utils/macros/x.sql'
    )
  })

  it('refuses a target that resolves outside the root', () => {
    expect(relativeInsideRoot('/w/repo', '/elsewhere/x.sql')).toBeNull()
    expect(relativeInsideRoot('/w/repo', '/w/repo/models/../../secrets.sql')).toBeNull()
    expect(relativeInsideRoot('/w/repo', '/w/repo-other/x.sql')).toBeNull()
    expect(relativeInsideRoot('/w/repo', '/w/repo')).toBeNull()
    expect(relativeInsideRoot(null, '/w/repo/x.sql')).toBeNull()
  })
})
