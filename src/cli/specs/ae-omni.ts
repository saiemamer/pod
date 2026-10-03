import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const BRANCH_NOTE =
  "The Omni model branch is named after this worktree's git branch, which is named after the initiative part."
const MODEL_NOTE =
  'The model is --model, else OMNI_MODEL_ID from the domain env or the environment. Credentials come from the domain (OMNI_API_KEY or OMNI_API_TOKEN, OMNI_BASE_URL) or the Omni CLI profile; values are never printed.'

/** Pod: Omni model branches for agents working in an Omni worktree. */
export const OMNI_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['omni', 'branch'],
    summary:
      "Show, or create with --create, the Omni model branch named after this worktree's git branch",
    usage: 'orca omni branch [--create] [--model <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'create', 'model'],
    examples: ['orca omni branch --json', 'orca omni branch --create --json'],
    notes: [BRANCH_NOTE, MODEL_NOTE]
  },
  {
    path: ['omni', 'validate'],
    summary: "Validate this worktree's Omni model branch (or the shared model when there is none)",
    usage: 'orca omni validate [--model <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model'],
    examples: ['orca omni validate --json'],
    notes: [
      BRANCH_NOTE,
      MODEL_NOTE,
      'Exits 0 even when the model has errors; read `valid` and `errors` in the JSON.'
    ]
  },
  {
    path: ['omni', 'commit'],
    summary:
      "Commit this worktree's Omni model branch to git, which opens or updates its pull request",
    usage: 'orca omni commit --message <text> [--model <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'message', 'model'],
    examples: ['orca omni commit --message "Expose ticket_channel on tickets" --json'],
    notes: [BRANCH_NOTE, MODEL_NOTE, 'Run `orca omni validate` first; the branch must exist.']
  }
]
