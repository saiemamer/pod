import { describe, expect, it } from 'vitest'
import { lineageLayer } from './lineage-layer'

const model = (path: string, name = 'orders'): Parameters<typeof lineageLayer>[0] => ({
  resourceType: 'model',
  path,
  name
})

describe('lineageLayer', () => {
  it('reads the layer from a folder at any depth', () => {
    expect(lineageLayer(model('models/staging/stripe/payments.sql'))).toBe('staging')
    expect(lineageLayer(model('models/finance/intermediate/payments_joined.sql'))).toBe(
      'intermediate'
    )
    expect(lineageLayer(model('models/domains/sales/marts/core/orders.sql'))).toBe('mart')
    expect(lineageLayer(model('models\\stg\\payments.sql'))).toBe('staging')
  })

  it('takes the deepest layer folder over a shallower one and over the name prefix', () => {
    expect(lineageLayer(model('models/marts/intermediate/x.sql'))).toBe('intermediate')
    expect(lineageLayer(model('models/marts/stg_orders.sql', 'stg_orders'))).toBe('mart')
  })

  it('falls back to the name prefix when no folder names a layer', () => {
    expect(lineageLayer(model('models/payments/stg_payments.sql', 'stg_payments'))).toBe('staging')
    expect(lineageLayer(model('models/int_orders.sql', 'int_orders'))).toBe('intermediate')
    expect(lineageLayer(model('models/core/fct_orders.sql', 'fct_orders'))).toBe('mart')
    expect(lineageLayer(model('models/core/dim_customers.sql', 'dim_customers'))).toBe('mart')
  })

  it('gives a model that matches nothing no layer', () => {
    // Why these: a file named like a layer, and a folder that only starts with one.
    expect(lineageLayer(model('models/reporting/staging.sql', 'staging'))).toBeNull()
    expect(lineageLayer(model('models/internal/orders.sql'))).toBeNull()
  })

  it('labels sources, seeds and snapshots by their resource type', () => {
    expect(
      lineageLayer({ resourceType: 'source', path: 'models/staging/sources.yml', name: 'orders' })
    ).toBe('source')
    expect(lineageLayer({ resourceType: 'seed', path: 'seeds/stg_codes.csv', name: 'x' })).toBe(
      'seed'
    )
    expect(lineageLayer({ resourceType: 'snapshot', path: 'snapshots/s.sql', name: 's' })).toBe(
      'snapshot'
    )
  })
})
