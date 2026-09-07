import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalBoolean, OptionalPositiveInt, OptionalString, requiredString } from '../schemas'
import { getAeDbtService } from '../../../ae/dbt/dbt-service'

const PathParams = z.object({
  path: requiredString('Missing path'),
  projectDir: OptionalString,
  target: OptionalString
})
const ShowParams = PathParams.extend({
  model: OptionalString,
  sql: OptionalString,
  limit: OptionalPositiveInt
})
const CompileParams = PathParams.extend({ model: OptionalString, sql: OptionalString })
const ListParams = PathParams.extend({ filter: OptionalString, refresh: OptionalBoolean })
const ModelParams = PathParams.extend({
  model: requiredString('Missing --model'),
  refresh: OptionalBoolean
})
const LineageParams = ModelParams.extend({ depth: OptionalPositiveInt })

/** Pod: `orca dbt ...` for agents. `path` is the caller's cwd; the service finds the project from it. */
export const DBT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'dbt.project',
    params: PathParams,
    handler: (params) => getAeDbtService().project(params)
  }),
  defineMethod({
    name: 'dbt.show',
    params: ShowParams,
    handler: (params) => getAeDbtService().show(params)
  }),
  defineMethod({
    name: 'dbt.compile',
    params: CompileParams,
    handler: (params) => getAeDbtService().compile(params)
  }),
  defineMethod({
    name: 'dbt.parse',
    params: PathParams,
    handler: (params) => getAeDbtService().parse(params)
  }),
  defineMethod({
    name: 'dbt.listModels',
    params: ListParams,
    handler: (params) => getAeDbtService().listModels(params)
  }),
  defineMethod({
    name: 'dbt.modelInfo',
    params: ModelParams,
    handler: (params) => getAeDbtService().modelInfo(params)
  }),
  defineMethod({
    name: 'dbt.lineage',
    params: LineageParams,
    handler: (params) => getAeDbtService().lineage(params)
  })
]
