import { describe, expect, it } from 'vitest'
import { lineageCentreFitOptions } from './use-lineage-centre-on-select'

describe('lineageCentreFitOptions', () => {
  it('fits the one node, never past 100 %, with no floor that could crop it', () => {
    const options = lineageCentreFitOptions('model.demo.stg_orders')
    expect(options.nodes).toEqual([{ id: 'model.demo.stg_orders' }])
    expect(options.maxZoom).toBe(1)
    // Why no minZoom: a floor would let a node wider than a narrow canvas crop its side buttons.
    expect(options.minZoom).toBeUndefined()
  })

  it('pads past the side buttons, which hang 10 px outside the node', () => {
    const padding = lineageCentreFitOptions('a').padding
    expect(typeof padding).toBe('string')
    expect(Number.parseInt(String(padding), 10)).toBeGreaterThan(10)
  })
})
