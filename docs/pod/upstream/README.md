# Upstream candidates

Two changes Pod carries that could go to Orca (stablyai/orca) as pull requests. Whether to open them was parked on 2026-10-03 until all Pod development is done; nothing has been sent to Orca. Each patch here is the change as Orca would take it: Orca's files only, no `// Pod` markers, no `FORK_TOUCHPOINTS.md`, and an Orca-style commit message. Both were built on v1.4.197, Pod's current base, and `git apply --check` passes on that tag.

| Patch | Pod commit | What it does |
| --- | --- | --- |
| `0001-orchestration-folder-workspace-coordinator.patch` | `pod(phase4): let a folder-workspace coordinator start worktree workers` | `worker-start --worktree new-child\|new-top-level` from a coordinator in a folder workspace failed with a bare `selector_not_found`. It now takes the repo from `--repo`, parents a `new-child` worktree to the folder workspace, and asks for `--repo` when it is missing. Three tests. |
| `0002-settings-tool-cmd-overrides.patch` | `pod(phase4): type toolCmdOverrides as a generic per-tool command map` | An optional `toolCmdOverrides: Record<string, string>` beside `agentCmdOverrides`, defaulting to `{}`. |

What each is worth, for the decision:

- 0001 fixes a real failure in Orca's own orchestration CLI, reachable by any folder-workspace user; Pod's initiatives are one case. Pod gains a smaller register only if Orca takes it. Until then Pod carries it as one register row over four Orca files (`FORK_TOUCHPOINTS.md`, Phase 4).
- 0002 adds a setting nothing in Orca reads yet. Orca may reasonably decline a slot with no consumer. Pod's gain is small: the two lines it adds to Orca's settings files would stop being Pod touches.

## Sending them later

First check that Orca has not fixed or changed the same code since v1.4.197 (this was not checked when the patches were made). Then rebuild each patch on Orca's `main` rather than sending these files as they are, since a pull request goes against `main`. For 0001, the Pod commit's `src/` changes are the whole patch:

```sh
git fetch --no-tags upstream main
git checkout -b orchestration-folder-coordinator upstream/main
git diff <pod-commit>~1 <pod-commit> -- src/ | git apply --3way
pnpm test src/main/runtime/rpc/methods/orchestration-workers-new-worktree.test.ts
```

For 0002, apply the patch file, or add the two lines by hand next to `agentCmdOverrides`. Then run Orca's own checks (`pnpm tc`, `pnpm test`, `pnpm lint`), push the branch to a fork, and open the pull request from there. Never push Pod's `main` or its tags to Orca.

`docs/pod/smoke/orchestration-folder-worker-smoke.mjs` shows 0001 working in the running app, through the real `orca` CLI.
