# Sync log: Orca v1.4.197 → v1.4.219 (2026-10-04)

The first real rebase of Pod onto a newer Orca tag, made with `node config/pod-sync-upstream.mjs v1.4.219` on `sync/v1.4.219`. One entry per stop the script handed over, in commit order. "Ours" is upstream (v1.4.219 plus the Pod commits already replayed), "theirs" the Pod commit being replayed.

## Counts

71 Pod commits replayed; none dropped, squashed or reordered. The script stopped 12 times. The rules alone cleared three stops: commit 1 `c504891f56` (`.gitattributes`, `config/electron-builder.config.cjs`, `package.json`), commit 3 `f0c5e678db` (`track-community-prs.yaml`, which Orca deleted, dropped) and commit 37 `bf72156f88` (`package.json`, `pnpm-lock.yaml`). The other nine needed a hand and are listed below; at one of them, commit 40, the rules also took `package.json` and `pnpm-lock.yaml`. Stop 2 was only `FORK_TOUCHPOINTS.md` clashing with this sync's own row edits from stop 1, and the register clashed the same way at stops 5, 7 and 8.

After the replay the script moved 20 new upstream workflows to `.github/workflows-upstream/` and bumped the base tag (`pod(sync): rebase onto Orca v1.4.219`).

## Stops resolved by hand

### Stop 1: commit 23 of 71, `9a7a7e1892` "pod(phase1): domains and initiatives, persistence, IPC, CLI, agent env"

- `src/cli/specs/index.ts`: Orca appended `SEARCH_COMMAND_SPECS` and `PROFILE_STATE_COMMAND_SPECS` to `COMMAND_SPECS`. Pod's `...DOMAIN_COMMAND_SPECS // Pod` goes after them, unchanged.
- `src/main/persistence/loading-store/store.ts`: Orca replaced the `Store` interface's extends list with one type, `StoreDomainOperations`, declared in `store-domain-composition.ts`. Pod's touch moved there: `AeDomainPersistence & // Pod` in `StoreDomainOperations`. `store.ts` is now upstream's file; its row in `FORK_TOUCHPOINTS.md` is folded into the composition row.
- `src/main/runtime/orca-runtime-create-agent-session.ts`, `orca-runtime-resolve-worktree-removal-target.ts`, `runtime-worktree-agent-startup.ts` (two sites): Orca moved the settings-derived launch inputs (`cmdOverrides`, `agentArgs`, `agentEnv`, shell, session options) into one shared function, `resolveAgentStartupPlanInputs` in `src/shared/agent-startup-plan-inputs.ts`, so the object literal Pod spread `podDomainAgentEnv` into is gone. Pod's touch changed shape: a Pod-owned `resolvePodAgentStartupPlanInputs(scope, args)` in `src/main/ae/domain-agent-env.ts` calls upstream's function and layers `podDomainAgentEnv(scope)` over its `agentEnv` (same precedence as before: domain over agent defaults). Each site swaps the import and the function name, one line each. Orca also added a fourth caller, `orca-runtime-resolve-mobile-session-terminal-command.ts`, which Pod never touched (Orca Mobile is hidden in Pod); left alone.
- `src/main/runtime/rpc/methods/index.ts`, `src/preload/api-types.ts`: Orca dropped an unused import next to Pod's import line. Pod's import stays; the dropped imports stay dropped.
- `src/renderer/src/store/index.ts`: Orca wrapped the store creator in `withDevelopmentStoreProbes` and imports `StateCreator`. Pod's `createAeDomainsSlice` import and spread re-applied inside the new wrapper.
- `FORK_TOUCHPOINTS.md`: composition row gains the `StoreDomainOperations` member, the `store.ts` row is gone, the three agent-env rows describe the wrapper.

### Stop 2: commit 24 of 71, `59a273978c` "pod(phase1): Tools and dbt settings pages; initiative and main-agent launchers"

- `FORK_TOUCHPOINTS.md`: the register edits from stop 1 clashed with this commit's new rows. Took the commit's register and re-applied the stop-1 row edits. No upstream file stopped.

### Stop 3: commit 25 of 71, `cf60d2afbc` "pod(phase1): ae-initiative, ae-dbt and ae-omni skills"

- `src/cli/bundled-skill-guides.ts` (generated): Orca's generated module changed, and Orca's generator now requires every stub topic to insert the two shared blocks from `skill-stubs/_shared/cli-resolution.md` (`<!-- shared: resolver -->` and `<!-- shared: no-guessing -->`, checked by `config/scripts/skill-stub-composition.mjs`); Pod's three stubs had neither, so the generator refused them. Pod's stubs (`skill-stubs/ae-dbt.md`, `ae-initiative.md`, `ae-omni.md`, Pod-owned) now follow Orca's stub shape: the one-line intro, the resolver block, `ORCA skills get <topic>` under Orca's heading, Pod's "load it when" paragraph unchanged, then the no-guessing block. Then regenerated `bundled-skill-guides.ts`, the three `skills/ae-*/SKILL.md` projections and `resources/skills/current-manifest.json` / `snapshot-registry.json` with the two generators, as the register says. The generator's three Pod lists auto-merged.

### Stop 4: commit 27 of 71, `dd9ca2cc76` "pod(phase1): domain menu, dialogs and initiative panel"

- `src/main/runtime/rpc/methods/client-ui-schemas.ts`: Orca moved the `ui.set` zod schemas, `STATIC_RIGHT_SIDEBAR_TABS` included, into `src/shared/rpc-contract/client-ui-params.ts` and left a re-export behind. Pod's `'initiative' // Pod` moved with the list; `client-ui-schemas.ts` is upstream's file again. The register row now names `client-ui-params.ts`.

### Stop 5: commit 30 of 71, `3fbc31bf5f` "pod(phase1): one folder-workspace reveal helper; register it in the surface census"

- `src/renderer/src/lib/worktree-activation-surface-caller-wiring.test.ts`: Orca's census dropped `repo-add-actions.ts`, renamed `worktree-creation-flow-execute.ts` to `worktree-creation-structured-session.ts` and added `onboarding-folder-agent-launch.ts`. Took Orca's list and appended Pod's `'src/renderer/src/ae/reveal-folder-workspace.ts' // Pod`, unchanged.
- `FORK_TOUCHPOINTS.md`: this commit's new row clashed with the earlier register edits; took the commit's register and re-applied them.

### Stop 6: commit 33 of 71, `db5fa18a56` "pod(phase2): jinja-sql language, dbt discovery and runner, orca dbt CLI, results dock"

- `src/cli/specs/index.ts`: same as stop 1 (Orca's two new spec groups); `...DBT_COMMAND_SPECS // Pod` follows Pod's domain line.
- `src/main/runtime/rpc/methods/index.ts`: same as stop 1 (Orca's dropped `RpcAnyMethod` import); Pod's `DBT_METHODS` import line kept.
- `src/renderer/src/lib/monaco-setup.ts`: Orca replaced the bare sequence of language registrations with `runMonacoSetupSteps([...])`, a list of labelled steps that each run in isolation, and added Typst and shell-Markdown registrations. Pod's `registerJinjaSqlLanguage(monaco)` became one step, `['Jinja SQL language registration', () => registerJinjaSqlLanguage(monaco)], // Pod`, after JSONL as before. Register row updated.

### Stop 7: commit 40 of 71, `62cc0740ae` "pod(phase3): lineage graph, sqlglot column lineage, React Flow canvas, Database explorer, orca dbt column-lineage"

The rules resolved `package.json` and `pnpm-lock.yaml` here (Pod's two new dependencies), as they did at commit 37, `bf72156f88`, before it.

- `src/main/runtime/rpc/methods/client-ui-schemas.ts`: as in stop 4; `'database' // Pod` goes after `'initiative'` in `client-ui-params.ts`.
- `FORK_TOUCHPOINTS.md`: this commit pads the tables; took its register and re-applied the earlier row edits.

### Stop 8: commit 60 of 71, `9005f5068b` "pod(phase4): Omni panel and orca omni branch|validate|commit"

- `src/main/runtime/rpc/methods/index.ts`: as in stop 1; Pod's `OMNI_METHODS` import kept.
- `src/main/runtime/rpc/methods/client-ui-schemas.ts`: as in stop 4; `'omni' // Pod` goes after `'database'` in `client-ui-params.ts`.
- `FORK_TOUCHPOINTS.md`: took the commit's register and re-applied the earlier row edits.

### Stop 9: commit 64 of 71, `93189873e3` "pod(phase4): let a folder-workspace coordinator start worktree workers"

Orca split `orchestration-workers.ts` and `orchestration-worker-topology.ts` into `src/main/runtime/rpc/methods/orchestration/worker/` and the code Pod fixed now runs across three files. Orca still looks the coordinator up with `showManagedWorktree`, which has no folder branch, so the bug Pod fixes is still there and the fix still applies. Re-applied with the same logic and the same three tests:

- `orchestration-worker-creation-target.ts` (Pod's new file) moved beside Orca's worker files as `orchestration/worker/worker-creation-target.ts`, import paths adjusted, body unchanged.
- `orchestration-workers.ts` (deleted by Orca): its code went to `local-worker-start.ts`, where `creationTarget = resolveWorkerCreationTarget({ runtime, coordinatorWorktreeId, requestedWorktree, repo })` replaces `creationWorktree = showManagedWorktree(...)`, the creation guard and `startOptions.repo` read `creationTarget.repoSelector`, and the target goes to `placeWorkerAgent`. Orca now finds the coordinator's workspace with `resolveDispatchCallerWorktreeId`, and the target is built from that id.
- `worker-start-agent-placement.ts` (new in Orca): `creationWorktree: PlacedWorktree` became `creationTarget: WorkerCreationTarget` and is passed on to `createWorkerWorktree` as `target`.
- `orchestration-worker-topology.ts` → `worker-topology.ts` and `worker-worktree-creation.ts`: `createWorkerWorktree` moved to the latter. Its `coordinatorWorktree` parameter became `target`, `repoSelector` is `target.repoSelector`, and the lineage takes `parentWorktree: target.parentWorktreeId` plus `parentWorkspace` for a folder. `worker-topology.ts` is upstream's file.
- `workers-new-worktree.test.ts`: Orca renamed the test after Pod's block ("…without a Dispatch capability"). Pod's helper and three tests go before it, unchanged; the file passes (23 tests).
- `FORK_TOUCHPOINTS.md`: the row names the new files.

## Checks

`pnpm tc` (node, web and cli projects) passed on the head carrying the fixes below, in 3 min 45 s.

The full local `pnpm test:pod` run on this Mac took 2 h 14 min (8,047 s): 15 of 9,862 files failed, 54 tests. GitHub's Pod PR checks on the same tree (https://github.com/saiemamer/pod/actions/runs/37206484092) took 9 min 14 s across eight test shards, a typecheck and a lint job. That run failed 5 test files and 2 lint errors.

Failed on GitHub and fixed here in five `pod(sync):` commits:

| File                                                                                                  | Cause                                                                                    | Fix                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/global-settings-types.ts` (lint, 301 lines)                                               | Orca's file is at 299 counted lines; Pod's two keys took it past 300.                    | Keys moved to `AeGlobalSettings` in `src/shared/ae/dbt-settings-types.ts`, intersected on the closing line.                                |
| `src/main/menu/register-app-menu.ts` (lint, 305 lines)                                                | Orca's file is exactly 300 counted lines.                                                | The mobile-button item moved to Pod-owned `pod-mobile-button-menu-item.ts`; Orca's file carries one import and one spread line, 296 lines. |
| `src/main/proxy-guarded-fetch-call-site-audit.test.ts`                                                | New Orca audit counts every `.fetch(` not on `net`.                                      | Pod's two calls go through `getMainHttpClient()`, the default session, like Orca's Jira entry; listed with a count of one each.            |
| `src/main/browser/browser-manager-tab-identity.test.ts`, `browser-manager-viewport-ownership.test.ts` | Both assert `ORCA_BACKGROUND_LAUNCH=1`, which Orca's CI sets.                            | `config/vitest.pod.config.ts` sets it in the test env.                                                                                     |
| `src/main/runtime/structured-session-cli-login-shell.live-shell.test.ts`                              | Spawns `/bin/zsh`, absent on ubuntu runners; it passed on macOS. Orca excludes it on CI. | Pod's config imports Orca's `UNIT_EXCLUDE` in place of its hand copy.                                                                      |
| `src/main/updater.feed-attempt-lifetime.test.ts`                                                      | Asserts Orca's `stablyai/orca` release feed URL.                                         | Added to the identity excludes.                                                                                                            |

Each fixed file passed alone under `config/vitest.pod.config.ts` (4 files, 71 tests, 1 skipped), the two excluded files no longer run, and `pnpm exec oxlint --format github` reports 0 errors.

Failed only in the local run, not rerun: `browser-route-webrtc-egress.electron.test.ts`, `cli/packaged-cli-assets.test.ts`, `codex-accounts/legacy-wsl-runtime-auth-drain-rollback-script.test.ts`, `codex-accounts/runtime-home-wsl-session-bridge.test.ts`, `git/command-runner/git-command-timeout-behavior.test.ts`, `orcad/orcad-bundle-native-load-order.test.ts`, `runtime/orchestration-cli-subprocess.test.ts`, `relay/subprocess.test.ts`, `terminal-search-long-wrapped-line.test.ts`, `palette-match/palette-match-performance.test.ts`, `pane-agent-identity-title-corpus.test.ts`. None of them failed on GitHub's runners, and the local run shared an 8 GB Mac with other work (load average about 9 during the run, over 100 at 15:17), so most look like timing failures; this is not yet shown file by file. On the operator's word (2026-10-04, 15:35) the suite now runs on GitHub only, so none were run alone here; a failure on GitHub's next run is the signal to look at one.
