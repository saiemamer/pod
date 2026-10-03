import { z } from 'zod'
import {
  OptionalBoolean,
  OptionalPositiveInt,
  OptionalString,
  requiredString
} from '../rpc-contract/rpc-param-primitives'

// Why shared: Orca's RPC params catalog only indexes schemas exported from src/shared.

export const DomainSelectorParams = z.object({
  domain: requiredString('Missing domain selector')
})

export const DomainInitiativeUpdateParams = z.object({
  initiative: requiredString('Missing initiative id'),
  run: OptionalString,
  status: OptionalString
})

export const DbtPathParams = z.object({
  path: requiredString('Missing path'),
  projectDir: OptionalString,
  target: OptionalString
})
export const DbtShowParams = DbtPathParams.extend({
  model: OptionalString,
  sql: OptionalString,
  limit: OptionalPositiveInt
})
export const DbtCompileParams = DbtPathParams.extend({
  model: OptionalString,
  sql: OptionalString
})
export const DbtListParams = DbtPathParams.extend({
  filter: OptionalString,
  refresh: OptionalBoolean
})
export const DbtModelParams = DbtPathParams.extend({
  model: requiredString('Missing --model'),
  refresh: OptionalBoolean
})
export const DbtLineageParams = DbtModelParams.extend({ depth: OptionalPositiveInt })
export const DbtColumnLineageParams = DbtLineageParams.extend({
  column: requiredString('Missing --column')
})

export const OmniPathParams = z.object({
  path: requiredString('Missing path'),
  modelId: OptionalString
})
export const OmniBranchParams = OmniPathParams.extend({ create: OptionalBoolean })
export const OmniCommitParams = OmniPathParams.extend({
  message: requiredString('Missing --message')
})
