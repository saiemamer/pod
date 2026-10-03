import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import type {
  OmniBranchResult,
  OmniCommitResult,
  OmniValidateResult
} from '../../shared/ae/omni-types'
import { formatOmniBranch, formatOmniCommit, formatOmniValidate } from '../ae-omni-format'

/** Every Omni call names the caller's cwd; the main process finds the worktree and branch from there. */
function baseParams(ctx: HandlerContext): Record<string, unknown> {
  return { path: ctx.cwd, modelId: getOptionalStringFlag(ctx.flags, 'model') }
}

export const OMNI_HANDLERS: Record<string, CommandHandler> = {
  'omni branch': async (ctx) => {
    const result = await ctx.client.call<OmniBranchResult>('omni.branch', {
      ...baseParams(ctx),
      create: ctx.flags.get('create') === true
    })
    printResult(result, ctx.json, formatOmniBranch)
  },
  'omni validate': async (ctx) => {
    const result = await ctx.client.call<OmniValidateResult>('omni.validate', baseParams(ctx))
    printResult(result, ctx.json, formatOmniValidate)
  },
  'omni commit': async (ctx) => {
    const result = await ctx.client.call<OmniCommitResult>('omni.commit', {
      ...baseParams(ctx),
      message: getRequiredStringFlag(ctx.flags, 'message')
    })
    printResult(result, ctx.json, formatOmniCommit)
  }
}
