import type { DbtGraphNode } from '../../../../shared/ae/dbt-graph-types'

/**
 * Pod: the dbt layer a node belongs to, shown as a small label on its header. Models
 * take it from the folders on their path (any depth, the deepest match wins), then
 * from their name prefix; sources, seeds and snapshots take their resource type.
 */
export type LineageLayer = 'staging' | 'intermediate' | 'mart' | 'source' | 'seed' | 'snapshot'

const FOLDER_LAYERS: Record<string, LineageLayer> = {
  staging: 'staging',
  stg: 'staging',
  stage: 'staging',
  intermediate: 'intermediate',
  int: 'intermediate',
  marts: 'mart',
  mart: 'mart'
}

const PREFIX_LAYERS: [string, LineageLayer][] = [
  ['stg_', 'staging'],
  ['int_', 'intermediate'],
  ['fct_', 'mart'],
  ['dim_', 'mart']
]

export function lineageLayer(
  node: Pick<DbtGraphNode, 'resourceType' | 'path' | 'name'>
): LineageLayer | null {
  if (
    node.resourceType === 'source' ||
    node.resourceType === 'seed' ||
    node.resourceType === 'snapshot'
  ) {
    return node.resourceType
  }
  // Why both separators: a manifest written on Windows records backslashes.
  const folders = node.path.split(/[\\/]/).slice(0, -1)
  for (let i = folders.length - 1; i >= 0; i -= 1) {
    const layer = FOLDER_LAYERS[folders[i].toLowerCase()]
    if (layer) {
      return layer
    }
  }
  const name = node.name.toLowerCase()
  return PREFIX_LAYERS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null
}

/** The short word on the node header. */
export const LINEAGE_LAYER_LABELS: Record<LineageLayer, string> = {
  staging: 'stg',
  intermediate: 'int',
  mart: 'mart',
  source: 'source',
  seed: 'seed',
  snapshot: 'snapshot'
}
