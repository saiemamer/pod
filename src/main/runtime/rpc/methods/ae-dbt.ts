import { defineMethod } from '../core'
import {
  DbtColumnLineageParams,
  DbtCompileParams,
  DbtLineageParams,
  DbtListParams,
  DbtModelParams,
  DbtPathParams,
  DbtShowParams
} from '../../../../shared/ae/ae-rpc-params'
import { getAeDbtService } from '../../../ae/dbt/dbt-service'
import {
  dbtColumnLineageRequest,
  dbtLineageWithColumns,
  getDbtLineageServices
} from '../../../ae/dbt/dbt-lineage-ops'

/** Pod: `orca dbt ...` for agents. `path` is the caller's cwd; the service finds the project from it. */
export const DBT_METHODS = [
  defineMethod({
    name: 'dbt.project',
    permission: 'workspace',
    params: DbtPathParams,
    handler: (params) => getAeDbtService().project(params)
  }),
  defineMethod({
    name: 'dbt.show',
    permission: 'workspace',
    params: DbtShowParams,
    handler: (params) => getAeDbtService().show(params)
  }),
  defineMethod({
    name: 'dbt.compile',
    permission: 'workspace',
    params: DbtCompileParams,
    handler: (params) => getAeDbtService().compile(params)
  }),
  defineMethod({
    name: 'dbt.parse',
    permission: 'workspace',
    params: DbtPathParams,
    handler: (params) => getAeDbtService().parse(params)
  }),
  defineMethod({
    name: 'dbt.listModels',
    permission: 'workspace',
    params: DbtListParams,
    handler: (params) => getAeDbtService().listModels(params)
  }),
  defineMethod({
    name: 'dbt.modelInfo',
    permission: 'workspace',
    params: DbtModelParams,
    handler: (params) => getAeDbtService().modelInfo(params)
  }),
  defineMethod({
    name: 'dbt.lineage',
    permission: 'workspace',
    params: DbtLineageParams,
    handler: (params) =>
      dbtLineageWithColumns(getAeDbtService(), getDbtLineageServices(), {
        ...params,
        upstreamDepth: params.depth
      })
  }),
  defineMethod({
    name: 'dbt.columnLineage',
    permission: 'workspace',
    params: DbtColumnLineageParams,
    handler: (params) => dbtColumnLineageRequest(getAeDbtService(), getDbtLineageServices(), params)
  })
]
