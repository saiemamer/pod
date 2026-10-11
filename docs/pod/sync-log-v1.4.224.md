# Sync log: Orca v1.4.219 → v1.4.224 (2026-10-11)

Made with `node config/pod-sync-upstream.mjs v1.4.224` on `sync/v1.4.224`, from `main` at `55b6a3725c`. One entry per stop the script handed over, in commit order. "Ours" is upstream (v1.4.224 plus the Pod commits already replayed), "theirs" the Pod commit being replayed.

## Counts

143 Pod commits replayed (`v1.4.219..main`); none dropped, squashed or reordered. Commit 80 is now empty (stop 14). The script stopped 23 times. The rules alone cleared three stops: commit 1 `64f9663591` (`.gitattributes`, `package.json`; `config/electron-builder.config.cjs` merged cleanly), commit 37 `b0137b6164` (`package.json`, `pnpm-lock.yaml`) and commit 101 `f4cb9ef16e` (`.gitattributes`). The other 20 needed a hand and are listed below; at one of them, commit 40, the rules also took `package.json` and `pnpm-lock.yaml`. Commit 130 waited on a decision from firstmate.

After the replay the script moved six new upstream workflows to `.github/workflows-upstream/` (`cloud-operate-relay-production-cell-flags.yml`, `macos-updater-tests.yml`, `preflight-cli-platforms.yml`, `release-javascript-benchmark.yml`, `release-javascript.yml`, `win-orcad-serve-switch-e2e.yml`) and bumped the base tag (`69109db05e`, `pod(sync): rebase onto Orca v1.4.224`).

### Running the script mid-rebase

`config/pod-sync-upstream.mjs` does not exist in the tree until the Pod commit that adds it is replayed, so `node config/pod-sync-upstream.mjs --continue` fails with `MODULE_NOT_FOUND` at the early stops. Every `--continue` here ran `main`'s copy from outside the tree (`git show main:config/pod-sync-upstream.mjs > <scratch>/pod-sync-upstream.mjs`, then `node <scratch>/pod-sync-upstream.mjs --continue` from the worktree). The script works on the repository in the current directory, so the copy behaves the same. A relaunch should do the same. `sync.md` should say so.

### Register edits that clash

This sync renames or removes register rows (stops 23, 30, 64, 106, 126), so later Pod commits that edit `FORK_TOUCHPOINTS.md` clash with those edits. At each such stop: take the commit's register (`git checkout --theirs FORK_TOUCHPOINTS.md`), re-apply this sync's row edits, then `oxfmt` it. The edits:

1. The `orca-runtime-resolve-worktree-removal-target.ts` row (both its `workspace` and later `podScope` forms) names `src/main/runtime/runtime-agent-terminal-startup.ts` instead.
2. The `worktree-activation-surface-caller-wiring.test.ts` row is deleted.
3. The orchestration worker row says "through placement (narrowed by `requireCreationTarget` in `launchWorkerAgent`) and creation".
4. The `minimax-api-key-store.ts` row names `src/main/credentials/encrypted-api-key-file-store.ts` and reads "The MiniMax API key and, since Orca v1.4.224, the OpenCode Go key: both go through Orca's shared API-key file store."
5. Commit 80's proxy-audit row is not added.

Defect to fix in part 2 or leave: at commit 40 the first two edits did not apply, because that commit pads the tables and my first `sed` matched single spaces only. Replayed commits 40 to 77 therefore still carry the old removal-target row and the census row. From commit 78 on the register is right. The rows sit in the register only; no code is affected.

## Stops resolved by hand

### Stop 1: commit 20 of 143, `881403efdf` "pod: branding pass and one-click Homebrew updates"

- `src/main/window/dashboard-popout-window.ts`: Orca added `type Event` to the `electron` import. Pod's `POD_PRODUCT_NAME` import line goes above it, unchanged. This is the stop the daily rehearsal (issue 25) reported.

### Stop 2: commit 21 of 143, `fd5065e10e` "pod: route two raw window titles through translateMain"

- `src/main/window/dashboard-popout-window.ts`: the same import line. Pod's `translateMain` import replaces the brand import, as the commit intends; Orca's `electron` import with `type Event` stays.

### Stop 3: commit 23 of 143, `f690f6e6ce` "pod(phase1): domains and initiatives, persistence, IPC, CLI, agent env"

- `src/main/persistence/loading-store/store-domain-composition.ts`: Orca registered two new domains, `OrcadSourceExportPersistence` and `OrcadCatalogImportPersistence`, in all five lists. Pod's `AeDomainPersistence` entries go after them, unchanged.
- `src/shared/persisted-state-types.ts`: Orca added `nativeChatUpgradeTipAudience`. Pod's three keys follow it.
- `src/main/runtime/orca-runtime-create-agent-session.ts`: Orca now builds the plan with `buildExecutionHostAgentStartupPlan` and dropped the `tui-agent-startup` import. Pod's swap (`resolvePodAgentStartupPlanInputs(workspace, …)` and its import in place of upstream's) is unchanged.
- `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts`: Orca moved the whole agent launch-options body into a new file, `src/main/runtime/runtime-agent-terminal-startup.ts` (`buildRuntimeAgentTerminalStartupOptions`), which now also plans prompt carry. Pod's touch moved with the code: in the new file, `resolvePodAgentStartupPlanInputs(workspace, {…})` replaces `resolveAgentStartupPlanInputs({…})` and the import is swapped. `workspace` is a `TerminalWorkspaceLaunchScope`, which carries `repo` and `folderWorkspace`. `orca-runtime-resolve-worktree-removal-target.ts` is upstream's file again. Register row renamed.
- `src/main/runtime/runtime-worktree-agent-startup.ts`: Orca split `buildWorktreeStartupForAgent` into `planInputs` plus a prompt-carry branch and added `extraAgentArgs`. Pod's swap goes on `planInputs` (`resolvePodAgentStartupPlanInputs(environment, {…})`); the draft site is unchanged.

### Stop 4: commit 24 of 143, `bfb579dde6` "pod(phase1): Tools and dbt settings pages; initiative and main-agent launchers"

- `src/shared/global-settings-types.ts`: Orca added the `NativeChatGlobalSettings` and `OrcaWorkspaceLayout` imports. Pod's import line kept.
- `FORK_TOUCHPOINTS.md`: took the commit's register and re-applied the stop-3 row edit.

### Stop 5: commit 27 of 143, `37ef36187d` "pod(phase1): domain menu, dialogs and initiative panel"

- `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx`: Orca added a lazy `NativeChatVisualPanel`. Pod's lazy `PodInitiativePanel` line follows it; the render line merged cleanly.

### Stop 6: commit 30 of 143, `983f9a4737` "pod(phase1): one folder-workspace reveal helper; register it in the surface census"

- `src/renderer/src/lib/worktree-activation-surface-caller-wiring.test.ts`: Orca deleted the census (`ca4e239861`, "Remove low-value test inventories and duplicate fuzz oracles", #25791). Pod's only touch listed `reveal-folder-workspace.ts` there, so the file stays deleted and its register row goes. The helper itself is unchanged.

### Stop 7: commit 33 of 143, `19411433c8` "pod(phase2): jinja-sql language, dbt discovery and runner, orca dbt CLI, results dock"

- `src/renderer/src/components/editor/EditorEditFileSurface.tsx`: Orca added a `getConnectionIdForFile` import. Pod's `PodDbtDock` import follows it.
- `src/renderer/src/lib/monaco-setup.ts`: Orca added a Quarto language step after JSONL. Pod's Jinja SQL step follows Quarto's.

### Stop 8: commit 40 of 143, `b5cf3558fd` "pod(phase3): lineage graph, sqlglot column lineage, React Flow canvas, Database explorer, orca dbt column-lineage"

The rules resolved `package.json` and `pnpm-lock.yaml` (`pnpm install --lockfile-only`).

- `FORK_TOUCHPOINTS.md`: took the commit's register. The re-applied row edits missed here; see "Register edits that clash".

### Stop 9: commit 64 of 143, `f6281953ef` "pod(phase4): let a folder-workspace coordinator start worktree workers"

Orca still finds the coordinator with `showManagedWorktree` in `local-worker-start.ts`, so the folder-workspace bug Pod fixes is still there, and the fix still applies.

- `src/main/runtime/rpc/methods/orchestration/worker/worker-start-agent-placement.ts`: Orca folded `placeInCreatedWorktree` and the existing-worktree branch into one `launchWorkerAgent`, driven by `executeAgentLaunch`, whose `createWorktree` callback calls `createWorkerWorktree`. Pod's change re-applied there: `creationTarget: WorkerCreationTarget | undefined` replaces `creationWorktree` in the args type and in `placeWorkerAgent`'s check, and the callback passes `target: requireCreationTarget(args.creationTarget)` in place of `coordinatorWorktree: requireWorktree(args.creationWorktree)`. `requireCreationTarget` is a new six-line narrowing helper beside Orca's `requireWorktree`. `local-worker-start.ts`, `worker-worktree-creation.ts` and the test merged cleanly. Register row names the helper.

### Stop 10: commit 65 of 143, `d6e806ac8a` "pod(phase4): type toolCmdOverrides as a generic per-tool command map"

- `src/shared/global-settings-types.ts`: the same import clash as stop 4. Pod's narrowed import (`AeDbtSettings` only) kept.

### Stop 11: commit 73 of 143, `3942221ca3` "pod(sync): catalogue Pod's RPC params for Orca's typed RPC contract"

- `src/shared/rpc-contract/rpc-params-catalog.generated.ts` (generated): Orca added `orcad.migration.*`, `orcad.terminalCensus` and `orchestration.callerShow`. The generator (`config/scripts/generate-rpc-params-catalog.mjs`) could not run here: `node_modules` is still `main`'s install and lacks `stream-json/core/utils/flex-assembler.js`, and this part does no install. The file is a sorted key map, so I merged it by key order (Pod's `omni.*` before Orca's `orcad.*`). Its diff against v1.4.224 is exactly Pod's import block and Pod's 14 `dbt.*`, `domain.*` and `omni.*` keys. **Part 2 must rerun `pnpm run generate:rpc-params-catalog`** after `pnpm install` and commit any change.

### Stop 12: commit 78 of 143, `42b9ba0fe7` "pod(sync): move Pod's settings keys out of Orca's GlobalSettings body"

- `src/shared/global-settings-types.ts`: the same import clash. Orca also moved `OrcaWorkspaceLayout` into its own file and made `GlobalSettings = NativeChatGlobalSettings & {…}`; Pod's closing `} & AeGlobalSettings // Pod` merged cleanly.
- `FORK_TOUCHPOINTS.md`: took the commit's register, re-applied the row edits, formatted.

### Stop 13: commit 79 of 143, `fa116294c8` "pod(sync): keep Orca's app menu file under the line limit"

- `src/main/menu/register-app-menu.ts`: Orca split the quit item and the Window menu into `app-menu-quit-item.ts` and `app-menu-window.ts` (two new imports). Pod's `podMobileButtonMenuItems` import follows them; the spread merged cleanly.

### Stop 14: commit 80 of 143, `d7db062da7` "pod(sync): list Pod's two fetch calls in Orca's proxy call-site audit"

- `src/main/proxy-guarded-fetch-call-site-audit.test.ts`: Orca deleted the audit in the same cleanup, #25791. Listing Pod's two fetch calls there was the commit's whole content, apart from its register row. The commit stays in place as an empty commit (`git commit --allow-empty -C d7db062da7`, original message and author), so no Pod commit is dropped. The row is not added.

### Stop 15: commit 91 of 143, `f75e997ea8` "pod(standalone): install the shell command as pod and keep Pod's orca first in its terminals"

Orca now ships the PATH half of this commit itself: `d9173ffbdb` "Keep Orca CLI first after shell startup" (#25130) and `bdf0d66d7c` (#26539). `prependOrcaCliDirToChildPath` sets `ORCA_CLI_BIN_DIR` to `<resources>/bin` on packaged macOS (after a new `getCliLauncherPath` host-launcher branch), and `ORCA_CLI_POSIX_PATH_RESTORE` re-prepends it in the zsh hook, both bash rcfiles and the relay wrapper. That is Pod's upstream candidate 0003.

- `src/main/cli/orca-cli-child-path.ts`: Pod's `delete env[BUNDLED_CLI_BIN_DIR_ENV]` goes before Orca's new host-launcher early return, so an inherited value is dropped on every path; the packaged-darwin `env[BUNDLED_CLI_BIN_DIR_ENV] = bundledCliBin` merged cleanly.
- `src/main/daemon/daemon-bash-shell-ready-rcfile.ts`: Pod's `${BUNDLED_CLI_BIN_DIR_RESTORE}` follows Orca's `${ORCA_CLI_POSIX_PATH_RESTORE}`.
- Shell wrapper snapshots: took v1.4.224's five files, then `pnpm test:pod src/main/shell-wrapper-generated-file-snapshot.test.ts -u` (5 updated, 7 tests passed). The diff against upstream is only Pod's PATH restore block, in the same five files as the original commit. `pod-cli-path-restore.test.ts` and `pod-shell-command.test.ts` pass (6 tests).

Pod's restore block now does nothing after Orca's: by then the same folder is already first, and its `case` skips the prepend. The `pod` shell-command half of the commit is unaffected. Dropping Pod's PATH half (the restore file, its five touches and the overlay key) is a follow-up for firstmate to decide, not part of this replay.

After the rebase (part 3), firstmate chose to drop the restore block and keep the overlay key: `pod(sync): drop Pod's PATH restore, which Orca v1.4.224 does inside its wrappers`. Orca's restore runs only in wrapped panes, and Orca leaves a plain pane unwrapped (#25130, "Preserve plain panes"), so without the key a plain bash pane, or a plain zsh pane without per-worktree history, would let `path_helper` put stock Orca's `orca` first. The key keeps every macOS pane wrapped, so Orca's restore keeps Pod's `orca` first there. `pod-cli-path-restore.ts` is gone, its constant moved to `src/main/pod/pod-pane-wrap-env.ts`, its real-shell test became `pod-pane-wrap-env.test.ts` (8 cases pass), the five snapshots now match v1.4.224, and Orca's `pty-spawn-env-terminal-basics.test.ts`, whose two bare-pane cases assert an unwrapped pane, is excluded in `config/vitest.pod.config.ts`.

### Stop 16: commit 106 of 143, `7017bf73cc` "pod(first-start): Claude workers an initiative dispatches run without asking"

- `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts`: Pod's two-line `podScope` touch follows the stop-3 move. In `runtime-agent-terminal-startup.ts`, `const podScope = { ...workspace, launchSource: opts.launchSource } // Pod` sits above `planExecutionHostStartupWithPromptCandidate`, and the call takes `podScope`. The removal-target file stays upstream's. Register row renamed. The commit message still names the old file.

### Stop 17: commit 122 of 143, `cb65e77d16` "pod(cli): orca dbt and orca omni describe their own flags in --help"

- `src/cli/command-scoped-flag-help.ts`: Orca added a `FILE_OPEN_FOCUS_HELP` constant at the top. Pod's `AE_COMMAND_FLAG_HELP` import goes above it; the spread merged cleanly.

### Stop 18: commit 126 of 143, `7fb0daa238` "pod(keychain): packaged Pod keeps its credential files in ~/.pod"

- `src/main/minimax/minimax-api-key-store.ts`: Orca replaced the file's body with a call to a shared factory, `createEncryptedApiKeyFileStore` in `src/main/credentials/encrypted-api-key-file-store.ts`, which Orca's new OpenCode Go key store also uses. Pod's touch moved into the factory: `getOrcaDir()` returns `integrationCredentialDir()`, and the `node:os` import becomes that import. `minimax-api-key-store.ts` is upstream's. Side effect: packaged Pod also keeps Orca's new OpenCode Go key file (`opencode-go-api-key.enc`) in `~/.pod`, which fits the register's rule that Pod keeps its API-key files there. `pod-credential-copy.ts` does not list that file. A copy Orca sealed could not be read anyway; an unsealed one would not be copied. `pod-credential-stores.test.ts` and `pod-credential-copy.test.ts` pass (15 tests). Register row renamed.

### Stop 19: commit 130 of 143, `f9016a594b` "pod(keychain): Pod asks again for saved settings it cannot read"

Orca moved the OpenCode Go API key out of settings in v1.4.224. It now lives in `opencode-go-api-key.enc`, in the shared encrypted API-key file store beside the MiniMax key, behind a new `OpenCodeGoCredentials` card (`accounts-pane-opencode-credentials.tsx`, with a Saved / Not saved badge and its own IPC). `legacy-opencode-go-api-key-migration.ts` moves the old sealed `settings.opencodeGoApiKey` into that file once; when it cannot decrypt the value it keeps the ciphertext parked. `PROTECTED_SECRET_SLOT.opencodeGoApiKey` and the renderer's `settings.opencodeGoApiKey` are gone, so Pod's notice for the key had no field to sit beside. The script stopped here for a decision, with two options: drop the notice for that key, or keep it on Orca's card through a new touch in that card.

Decision (firstmate, 2026-10-11): drop the notice for the OpenCode Go API key and keep the other three. The key no longer lives in the profile state as a sealed setting, so the settings notice has nothing to point at. Keeping it would add a new touch and new UI in an Orca card that every later sync would have to carry, and Saiem prefers the fewest lines in Orca files.

- `src/renderer/src/components/settings/accounts-pane-provider-setting-sections.tsx`: Orca's side of the conflict block (`<OpenCodeGoCredentials onSaved=…/>`). Pod's `PodUnreadableSettingNotice` import and the session-cookie notice stay.
- `src/main/pod/pod-unreadable-settings.ts`, `src/shared/ae/pod-unreadable-types.ts`: the `opencodeGoApiKey` entry, union member and label removed.
- `src/main/pod/pod-unreadable-settings.test.ts`, `src/renderer/src/ae/PodUnreadableSettingNotice.test.tsx`: the cases that used the API key use the session cookie instead. Both files pass (5 tests).
- `docs/pod/install.md`: "Three encrypted settings", no longer naming the API key.
- `FORK_TOUCHPOINTS.md`: the accounts-pane row names the cookie notice only and says why the key has none.

A person whose OpenCode Go key Orca sealed now sees the card's "Not saved" badge with no Pod explanation. Orca keeps the old ciphertext parked.

### Stop 20: commit 131 of 143, `a50162e9ed` "pod(keychain): one notice at first start lists the values Pod cannot read"

- `FORK_TOUCHPOINTS.md`: took the commit's register and re-applied this sync's row edits, the stop-19 accounts-pane row included.
- Follows from the stop-19 decision, though git did not flag it: `PodStartNoticeHost.tsx`'s `SETTING_PANES` (a `Record<PodUnreadableSetting, …>`) loses its `opencodeGoApiKey` entry, and `PodStartNoticeHost.test.tsx` uses the session cookie in its place. Both start-notice test files pass (7 tests).

## Range-diff

`git range-diff v1.4.219..main v1.4.224..sync/v1.4.224`: of Pod's 143 commits, 115 are identical (`=`), 27 differ (`!`), and commit 80 shows as removed and re-added (`<` / `>`) because it is now empty. After them comes `69109db05e`, the script's own commit. `git log --oneline v1.4.224..sync/v1.4.224` counts 144.

| Commits                                                                         | How they changed                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20, 21, 23, 24, 27, 30, 33, 40, 64, 65, 73, 78, 79, 91, 106, 122, 126, 130, 131 | Content changed at the hand stops above.                                                                                                                                      |
| 80 `d7db062da7`                                                                 | Empty: Orca deleted the audit it edited (stop 14).                                                                                                                            |
| 1 `64f9663591`, 101 `f4cb9ef16e`                                                | Rule stops. Pod's lines in `package.json` and `.gitattributes` are the same; the surrounding upstream lines are v1.4.224's.                                                   |
| 37 `b0137b6164`                                                                 | Rule stop. The lockfile change is regenerated on v1.4.224's lockfile by `pnpm install --lockfile-only`.                                                                       |
| 4 `9287cd536e`, 89 `62634213c6`, 98 `4c7ad460df`                                | No change to Pod's content; only the upstream lines around Pod's edits moved (README and `.gitignore` text Pod replaces, imports beside Pod's line, one line next to a hunk). |
| 60 `7ab8eb21b9`                                                                 | No change to Pod's content; Orca's new imports and lines sit beside Pod's in the CLI manifest, RPC method index and right sidebar.                                            |
| 128 `67b3524790`                                                                | Register only: it carries the stop-18 credential row.                                                                                                                         |

## What Orca's five releases change for Pod's user

Read from the code at the two tags; nothing here has been run.

- Orca keeps its own CLI first on PATH in terminals now (#25130, #26539), so Pod's PATH restore block (candidate 0003) runs after Orca's and does nothing (stop 15). Whether to drop Pod's copy is a follow-up for firstmate.
- The OpenCode Go API key moved out of settings into `opencode-go-api-key.enc`, behind Orca's new `OpenCodeGoCredentials` card, with a one-time migration from the old setting. Through Pod's credential-folder touch (stop 18) packaged Pod keeps that file in `~/.pod`, as it does the MiniMax key. A key Orca sealed under its own Keychain item stays parked: the card shows "Not saved", and Pod no longer explains why (stop 19).
- Orca removed two test inventories Pod had entries in (#25791), so Pod no longer registers its reveal helper or its two fetch calls anywhere.

## For part 2

- Rerun `pnpm run generate:rpc-params-catalog` after `pnpm install` and commit any change (stop 11).
- Commits 40 to 77 carry two stale register rows (see "Register edits that clash"); the final register is right.
- `sync.md` could say that the script has to run from a copy outside the tree during the early stops.
- The checks under "When the script has finished" in `sync.md`, and the release-job comparison: Orca added `release-javascript*.yml` and `macos-updater-tests.yml`, now under `.github/workflows-upstream/`.

## Excluded on GitHub's Linux runner

Two of Orca's own tests, which Pod does not touch, pass on macOS and failed on both attempts of pod-pr.yml run 38178276006 on ubuntu. `config/vitest.pod.config.ts` leaves them out on Linux only (`POD_RUNNER_TEST_EXCLUDES`):

- `src/main/ssh/ssh-remote-commands.test.ts`: "bounds real POSIX GC output with more than the exec-cap stage population" expects `relay-0.1.0+aaa` before `relay-0.1.0+bbb`, but `listRelayBaseDirsCommand` prints them in `find`'s directory order. APFS returns names sorted, ext4 in hash order. Orca's `unit-tests.yml` runs on ubuntu too, so the order there depends on the runner's filesystem.
- `src/renderer/src/components/native-chat/use-structured-agent-session.cut-turn-notice.test.tsx`: every case passes, then React's scheduler runs on `setImmediate` after happy-dom has torn down and throws `window is not defined`, because the file never unmounts its two `renderHook` calls. Orca runs the file under Bun (`config/scripts/run-vitest.mjs`); Pod's `pod-pr.yml` runs it under Node. Not checked under Bun here: this Mac has no Bun.
