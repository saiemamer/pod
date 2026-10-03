import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalBoolean, OptionalString, requiredString } from '../schemas'
import { getAeOmniService } from '../../../ae/omni/omni-service'

const PathParams = z.object({
  path: requiredString('Missing path'),
  modelId: OptionalString
})
const BranchParams = PathParams.extend({ create: OptionalBoolean })
const CommitParams = PathParams.extend({ message: requiredString('Missing --message') })

/** Pod: `orca omni branch | validate | commit` for agents; the panel reads over IPC. `path` is the caller's cwd; the service finds the worktree from it. */
export const OMNI_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'omni.branch',
    params: BranchParams,
    handler: (params) => getAeOmniService().branch(params)
  }),
  defineMethod({
    name: 'omni.validate',
    params: PathParams,
    handler: (params) => getAeOmniService().validate(params)
  }),
  defineMethod({
    name: 'omni.commit',
    params: CommitParams,
    handler: (params) => getAeOmniService().commit(params)
  })
]
