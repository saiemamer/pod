import type {
  OmniBranchResult,
  OmniCommitResult,
  OmniValidateResult
} from '../shared/ae/omni-types'

/** Pod: human output for `orca omni ...`; `--json` prints the raw result instead. */
export function formatOmniBranch(result: OmniBranchResult): string {
  const head = result.branch
    ? `${result.created ? 'Created' : 'Found'} Omni branch ${result.branch.name} (${result.branch.id}) on model ${result.modelId}.`
    : `No Omni branch named ${result.branchName} on model ${result.modelId}. Run \`orca omni branch --create\`.`
  const others = result.branches.filter((branch) => branch.name !== result.branchName)
  return others.length > 0
    ? [head, `Other active branches: ${others.map((branch) => branch.name).join(', ')}`].join('\n')
    : head
}

export function formatOmniValidate(result: OmniValidateResult): string {
  const target = result.branch
    ? `branch ${result.branch.name}`
    : `model ${result.modelId} (no branch for this worktree)`
  const head = result.valid
    ? `Valid: ${target}, ${result.warnings} warning(s).`
    : `Invalid: ${target}, ${result.errors} error(s), ${result.warnings} warning(s).`
  const lines = result.issues.map((issue) => {
    const where = issue.yamlPath ?? [issue.view, issue.field].filter(Boolean).join('.')
    const fix = issue.autoFix ? ` (auto-fix: ${issue.autoFix})` : ''
    return `${issue.severity}${where ? ` ${where}` : ''}: ${issue.message}${fix}`
  })
  return [head, ...lines].join('\n')
}

export function formatOmniCommit(result: OmniCommitResult): string {
  return [
    `Committed Omni branch ${result.branch.name}: ${result.gitSha ?? 'nothing new to commit'}`,
    `pull request: ${result.prUrl ?? 'none reported'}; in sync with git: ${result.inSync ? 'yes' : 'no'}`
  ].join('\n')
}
