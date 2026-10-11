import { parseWorkspaceKey } from '../../../../../../shared/workspace-scope'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { assertOrchestrationWorktreeCreationSupported } from './folder-worktree-placement'

/** A folder parent goes by its workspace key, as `worktree create --parent-worktree folder:<id>` does. */
export type WorkerCreationTarget = {
  repoSelector: string
  parentWorktreeId?: string
  parentWorkspace?: string
}

/** Where a new-child or new-top-level worker's worktree is created, from the coordinator's workspace. */
export async function resolveWorkerCreationTarget(args: {
  runtime: OrcaRuntimeService
  coordinatorWorktreeId: string
  requestedWorktree: string
  repo?: string
}): Promise<WorkerCreationTarget> {
  const { runtime, coordinatorWorktreeId, requestedWorktree, repo } = args
  // Why: a folder workspace is not a managed worktree, so looking it up fails with
  // selector_not_found. It can still parent a worktree, and --repo names the repo it lacks.
  if (parseWorkspaceKey(coordinatorWorktreeId)?.type === 'folder') {
    if (!repo) {
      throw new OrchestrationError(
        'invalid_argument',
        'A folder workspace has no repo of its own; pass --repo <selector> to create a worktree from it.'
      )
    }
    return {
      repoSelector: repo,
      parentWorkspace: requestedWorktree === 'new-child' ? coordinatorWorktreeId : undefined
    }
  }
  const coordinator = await runtime.showManagedWorktree(`id:${coordinatorWorktreeId}`)
  return {
    repoSelector: repo ?? coordinator.repoId,
    parentWorktreeId: requestedWorktree === 'new-child' ? coordinator.id : undefined
  }
}

/** The target, refused for a folder repo as Orca's local-worker-start.ts did inline; moved here
 *  to keep that file under the line limit. Undefined when the worker reuses a workspace. */
export async function resolveCheckedWorkerCreationTarget(args: {
  runtime: OrcaRuntimeService
  createsWorktree: boolean
  coordinatorWorktreeId: string
  requestedWorktree: string
  repo?: string
}): Promise<WorkerCreationTarget | undefined> {
  if (!args.createsWorktree) {
    return undefined
  }
  const target = await resolveWorkerCreationTarget(args)
  await assertOrchestrationWorktreeCreationSupported({
    runtime: args.runtime,
    repoSelector: target.repoSelector,
    existingPlacement: 'current or an exact existing folder workspace'
  })
  return target
}
