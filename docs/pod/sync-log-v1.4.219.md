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

The second GitHub run, on head `0f42af03f5` with the fixes above (https://github.com/saiemamer/pod/actions/runs/37209412974), passed every job: typecheck, lint and all eight test shards, in 8 min 59 s. None of the eleven local-only failures came back there.

### Excluded upstream tests

Each file `config/vitest.pod.config.ts` excludes by name ran with `pnpm test <files>`, Orca's own config, on this tree: 20 files, 17 failed and 3 passed.

| List                                                     | Result on v1.4.219                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verdict                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `POD_IDENTITY_TEST_EXCLUDES` (16 files)                  | All 16 fail, each on an Orca identity value Pod replaces: `com.stablyai.orca*` bundle ids in the press-and-hold and TCC tests, Orca's app id in the local-build compatibility contract, release feeds mocked on `github.com/stablyai/orca` and `stablyai/orca-hourly` URLs in the updater tests (Pod's feed asks `saiemamer/pod`, so the mocks never answer), the `stablyai/orca/releases` link in `UpdateCard`, and the "Current version: 1.4.100" line Pod suffixes in `GeneralPane`. | Every entry still needed.       |
| `POD_MOVED_WORKFLOW_TEST_EXCLUDES` (1 file)              | `windows-lane-tree-removal-boundary.test.ts` cannot load: it opens `.github/workflows/pr.yml`, which Pod keeps in `.github/workflows-upstream/`.                                                                                                                                                                                                                                                                                                                                        | Still needed.                   |
| `UPSTREAM_RED_AT_BASE_TAG_EXCLUDES` (3 files)            | The three `artifact-cloud-*` tests pass, 34 tests, under Orca's config and under Pod's.                                                                                                                                                                                                                                                                                                                                                                                                 | Stale; dropped in `28c8ad3656`. |
| Orca's `UNIT_EXCLUDE`, imported from `ci-unit-files.mjs` | Orca's own list of tests that need a live shell, node-pty or a real Chrome, which Orca's CI skips too. Pod imports it unchanged and has no entries of its own there.                                                                                                                                                                                                                                                                                                                    | Not Pod's to prune.             |

The bundled-skill and RPC catalog generators (`generate:bundled-skill-guides`, `generate:skill-bundle-manifest`, `generate:rpc-params-catalog`) ran again on the final tree and changed nothing.

## Summary

### Stops

12 stops in 71 Pod commits: 3 cleared by the script's rules alone (commits 1, 3 and 37) and 9 resolved by hand (commits 23, 24, 25, 27, 30, 33, 40, 60 and 64). At commit 40 the rules also took `package.json` and `pnpm-lock.yaml` before the hand resolution.

### Range-diff

`git range-diff v1.4.197..main v1.4.219..sync/v1.4.219`: of Pod's 71 commits, 57 are identical (`=`) and 14 differ (`!`); none is missing. After them come the `pod(sync):` commits, from `b421fb9f69` "rebase onto Orca v1.4.219" to the one that finishes this log.

| Commits                            | How they changed                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23, 24, 25, 27, 30, 33, 40, 60, 64 | Content changed at the hand stops above.                                                                                                                                                                                                                                        |
| 1 `c504891f56`                     | Rule stop. Pod's identity lines in `package.json`, `.gitattributes` and `electron-builder.config.cjs` are the same; the surrounding upstream lines are v1.4.219's.                                                                                                              |
| 3 `f0c5e678db`                     | Rule stop. The move of `track-community-prs.yaml` into `.github/workflows-upstream/` is gone, because Orca deleted the workflow.                                                                                                                                                |
| 37 `bf72156f88`                    | Rule stop. The lockfile change grew from 9 to 94 lines: `pnpm install --lockfile-only` added Pod's `vscode-jsonrpc` and also pruned entries v1.4.219's lockfile listed but nothing used (`@inquirer/*`, `@swc/types` and others). GitHub's frozen-lockfile install accepted it. |
| 4 `c577ed6c77`                     | No change to Pod's content. Pod replaces Orca's README, and the Orca lines it removes are now v1.4.219's.                                                                                                                                                                       |
| 22 `45bd79b585`                    | No change to Pod's content; one hunk header in `SidebarNav.tsx` moved.                                                                                                                                                                                                          |

### Checks

| Check                                                       | Result                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck:web` | Passed locally on an earlier head; covered on the final fixes by GitHub's typecheck job, which runs `pnpm tc`.                                    |
| `pnpm tc`                                                   | Passed locally (3 min 45 s) and on GitHub at `0f42af03f5`.                                                                                        |
| Lint (`pnpm exec oxlint --format github`)                   | 0 errors locally after the fixes; passed on GitHub at `0f42af03f5`.                                                                               |
| `pnpm test:pod`                                             | Local run (2 h 14 min) failed 15 files, cut to 11 local-only failures by the fixes, none rerun here. GitHub at `0f42af03f5`: all 8 shards passed. |
| Excluded upstream tests                                     | Run as above; three stale exclusions dropped.                                                                                                     |
| Bundled skills and RPC catalog                              | Skills regenerated at stop 3, RPC params catalog in `3942221ca3`; no drift on the final tree.                                                     |

GitHub has not yet run the final head, which adds the three `artifact-cloud-*` files back to `test:pod`.

#### Not yet run

The smokes in `docs/pod/smoke/README.md`, the data check at the end of `docs/pod/sync.md`, and the lineage performance gate against `main`. Firstmate runs them.

### What Orca's 22 releases change for Pod's user

- Saved state moves into SQLite. The first start of the updated Pod imports `profiles/local-default/orca-data.json` into `profile-state.db` beside it, Pod's `aeDomains`, `aeInitiatives` and `aeDomainSecrets` included, as far as Orca's code shows (the data check is what proves it). From then on `orca-data.json` is a compatibility copy Orca rewrites on a clean quit and during profile maintenance. Evidence: `src/shared/profile-state-storage-paths.ts`, `src/main/persistence/profile-state/legacy-json/README.md`, `src/main/startup/main-process-quit.ts:211`.
- Going back to a v1.4.197-based Pod is risky. The older Pod reads `orca-data.json`, which after a crash can be older than the database. If it saves, the next start of the updated Pod shows "Choose profile state"; its default, "Use SQLite (Recommended)", discards the edits made in the older version (`profile-state-startup-recovery-dialog.ts:81-97`). A release note should tell users not to downgrade.
- Cmd+comma no longer opens Settings unless the user binds it (Orca #23136, `0a5e73e3bb`, "Leave Open Settings unbound by default"). Settings stays in the app menu, and the shortcut can be set back in the keybindings settings as `app.settings`.
- `pod-release.yml` as it stood at this sync fails twice on v1.4.219, read from the scripts and corrected after `main` landed. First, `pnpm build:release` now ends with `pnpm run build:mobile-web`, which resolves React Native and Expo from `mobile/node_modules`, and the root install leaves that folder empty, so "Build app" fails before any release exists. Second, electron-builder's new `beforePack` (`config/electron-builder.config.cjs`) requires the `sherpa-onnx` and `@parcel/watcher` variants for each slice it packages, and `pnpm-workspace.yaml` installs only the runner's CPU, so on the arm64 runner the x64 slice fails after the job has created the draft release. Orca's mac job added `./.github/actions/install-mobile-dependencies` and `pnpm install --frozen-lockfile --cpu=current,x64,arm64` for these; the `pod(release):` commit after this sync adds both to `pod-release.yml`, with a `mode=trial` dispatch that builds a branch and publishes nothing. No build has run on this tree yet, so the trial run is the proof.

`docs/pod/sync.md`, "What an update keeps", described `orca-data.json` as the live store, and its path had already been wrong at v1.4.197, which kept state under `profiles/<id>/`. This commit rewrites that section for the SQLite store. The "Where it stands" section still says Pod is on v1.4.197; it becomes true again only when this branch lands.
