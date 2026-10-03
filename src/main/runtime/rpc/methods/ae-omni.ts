import { defineMethod } from '../core'
import {
  OmniBranchParams,
  OmniCommitParams,
  OmniPathParams
} from '../../../../shared/ae/ae-rpc-params'
import { getAeOmniService } from '../../../ae/omni/omni-service'

/** Pod: `orca omni branch | validate | commit` for agents; the panel reads over IPC. `path` is the caller's cwd; the service finds the worktree from it. */
export const OMNI_METHODS = [
  defineMethod({
    name: 'omni.branch',
    params: OmniBranchParams,
    handler: (params) => getAeOmniService().branch(params)
  }),
  defineMethod({
    name: 'omni.validate',
    params: OmniPathParams,
    handler: (params) => getAeOmniService().validate(params)
  }),
  defineMethod({
    name: 'omni.commit',
    params: OmniCommitParams,
    handler: (params) => getAeOmniService().commit(params)
  })
]
