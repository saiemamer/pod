# Pod: an analytics-engineering fork of Orca

## Context

Orca (onorca.dev, github.com/stablyai/orca) is an MIT-licensed Electron IDE for running many coding agents in parallel, one git worktree per agent. arezki1990 forked Zed into "zdbt" and added native dbt tooling (Jinja-aware SQL, dbt LSP, Cmd+Enter results grid, compiled SQL, column-level lineage canvas, project discovery, a dbt settings page, six MCP tools). Saiem wants the same treatment for Orca, plus what Orca lacks for analytics-engineering work: team folders that hold several repos, and one coordinator agent that runs a cross-repo initiative (for example the Zendesk to OpenCX migration: N workers in dbt-analytics-2 worktrees, then N workers in omni-analytics worktrees editing Omni topics and measures through the Omni CLI). The result should be a product colleagues can install, with dbt and omni binary paths set in settings, and it must keep receiving Orca's upstream fixes.

Decisions already taken with Saiem (2026-09-07):

| Decision | Choice |
|---|---|
| Fork depth | Thin fork tracking upstream stable tags, additive code, touchpoint register, upstream PRs for generic pieces |
| dbt flavour, warehouse | dbt Core on BigQuery first; keep a `distribution: core | fusion` switch |
| Distribution | Unsigned macOS DMG from GitHub Releases, auto-update from our own feed |
| Name, home | **Pod**, repo `saiemamer/pod` (a pod is a family group of orcas) |

Research inputs: the Orca source at v1.4.197 and dbt-zed's `dbt` branch; Orca docs (worktrees, CLI reference, orchestration, skills, settings, ways-to-run); Omni CLI docs and the `@omni-co/model-local-editor` guide; dbt LSP docs; the j-clemons Go dbt language server; Saiem's ae-* skills pack and WORKFLOW.md.

## What the research established

**Orca stack and scale.** Electron 43, React 19, Vite, Zustand, Monaco (with a vscode-textmate pipeline), xterm, node-pty, `node:sqlite`. 1.6M lines of TypeScript plus 1.9M lines of tests. ~130 commits and one stable release per day. MIT, no CLA, no trademark clause. Node 24 and pnpm 12 required.

**Project model.** An Orca "project" is one git remote identity (`src/shared/project-host-setup-projection.ts:101`). Project groups exist, nest, and can be created by scanning a parent folder for repos, but the source says "Execution remains repo-scoped" (`src/shared/repo-types.ts`). Folder workspaces (non-git directories) exist and belong to a project group (`src/shared/folder-workspace-types.ts`).

**Orchestration already spans repos.** A Run is a namespace with no repo column (`src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts`). `orca orchestration worker-start` accepts `--repo <selector>` for new worktrees (`src/cli/specs/orchestration-worker-specs.ts:8`), tasks carry a `deps` DAG, workers report `worker_done`, and a coordinator can wait with `orca orchestration check --wait`. Sub-dispatch depth is capped by `nestedWorkerMaxDepth`. So the cross-repo scheduler exists; what is missing is a team-level object, a coordinator home, and a playbook.

**Extension surface.** The plugin API is experimental, off by default, and its capabilities cannot spawn processes or read files, so native dbt panels need a fork. The stable extension points are the `orca` CLI (~230 commands, self-describing via `orca agent-context --json`), bundled skills (`skills/*/SKILL.md` + `skill-guides/`), `orca.yaml`, and managed agent hooks. Orca does not inject MCP servers into agents.

**Settings precedent.** `agentCmdOverrides` in `src/shared/global-settings-types.ts:366` is the per-binary path override pattern to copy for `dbt` and `omni`. Optional new settings keys survive load and are renderer-writable without edits (`normalize-loaded-global-settings.ts:59`, `src/main/ipc/settings.ts:49-58`). Unknown top-level `PersistedState` keys round-trip untouched (`src/shared/persisted-state-types.ts:56-63`).

**Updates and branding.** electron-updater with a generic feed at `src/main/updater/updater-release-feed.ts:206`; release repos in `src/shared/release-channel.ts`; appId and publish target in `config/electron-builder.config.cjs`. PostHog only initialises when `ORCA_POSTHOG_WRITE_KEY` is defined at build time (`src/main/telemetry/client.ts:26-39`), so an unset key means no telemetry.

**dbt-zed as a spec.** ~10,200 lines added on top of Zed, of which ~3,000-3,500 is portable logic (settings, discovery, dbt invocation, manifest/catalog graph with three-phase column resolution, six agent tools, column lineage via SQL AST with name-matching fallback). The rest is GPUI rendering that Pod rewrites in React. dbt-zed is GPL-3.0 because it vendors sqlitegraph; **no code is copied from it**, only the feature list. Its update stance: dbt is never bundled, the binary path is a setting.

**Development machine.** macOS 13 Ventura, Node 22, pnpm 10, Claude Code 2.1.263, gh 2.86. No dbt, omni, Rust, Orca or Zed installed. Orca's macOS packaging needs Swift 6 (Xcode 16, macOS 14+) for the Computer Use helper, so packaging happens on a GitHub `macos-15` runner; local development uses `pnpm dev` only.

## Architecture

### Vocabulary and how it maps to Orca objects

| Pod term | Orca object | Pod addition |
|---|---|---|
| **Team** | `ProjectGroup` (created by importing a parent folder) | `aeTeams[groupId]`: member repos with role `dbt`, `omni` or `other`; default agent; tool env; secret references; dbt profile and target |
| **Repo** | `Project` + `Repo` (kind `git`, `projectGroupId` = team) | none |
| **Initiative** | one orchestration Run + a `FolderWorkspace` under the team folder that hosts the coordinator terminal | `aeInitiatives[]`: id, teamId, title, runId, repoIds, coordinator workspace key, status |
| **Phase** | task DAG via `--deps` | task spec header names the target repo |
| **Worktree** | managed worktree at `~/orca/workspaces/<repo>/<name>` | for `omni` repos the worktree name equals the git branch and the Omni model branch |

On disk:

```
~/teams/mex/                          Team folder (ProjectGroup.parentPath)
  dbt-analytics-2/                    Repo
  omni-analytics/                     Repo
  initiatives/opencx-migration/       Initiative home: INITIATIVE.md, plan, handoff notes
~/orca/workspaces/<repo>/<name>       worktrees (Orca default, unchanged)
```

The initiative flow the `ae-initiative` skill encodes, using only CLI commands that exist today:

1. Coordinator (Claude Code) opens in the initiative folder workspace with `INITIATIVE.md` prefilled.
2. `orca orchestration run-create --objective "..."`, then `task-create` per part with `--deps` so Omni tasks depend on dbt tasks.
3. Per dbt task: `orca orchestration worker-start --task <id> --worktree new-top-level --repo id:<dbt-repo> --name opencx-<part> --agent claude`. Fallback if creation from a folder terminal is refused: `orca worktree create --repo id:<dbt-repo> --parent-worktree folder:<id> --agent claude --json`, then `worker-start --worktree id:<new>`.
4. `orca orchestration check --wait --types worker_done,escalation` until the dbt phase settles; the coordinator reviews diffs and opens MRs.
5. Same for the omni repo, with the `ae-omni` skill: `omni models create-branch`, `yaml-create`, `validate`, `commit`; branch name equals worktree name.
6. The Initiative panel (right sidebar, folder-only) shows tasks, dispatches and worktrees for the run.


### Phase 1 vocabulary decision (2026-09-07, Saiem)

"Team" in the table above becomes **Domain**: a folder of repos opened and named once (for Saiem, `~/saiemamer` named "MEX"), holding dbt, Omni and other repos with a role each. A Domain has one standing **main agent** (a Claude Code session in the domain folder with the initiative skill) that turns a request into an **Initiative** (an orchestration run with a folder under `initiatives/`), tagged with the stakeholder team it serves (Support Optimisation, Channels, Customer IAM, App Engagement, Dev-rel), and dispatches workers with a role (dbt, omni, infra) into worktrees of the right repo. "Project" keeps Orca's meaning (one repo). Code names follow: `aeDomains`, `AeDomainConfig`, `orca domain ...`, `AeDomainSettingsDialog`, `AeNewInitiativeDialog`.

### Code layout and fork discipline

- All Pod code lives in additive directories: `src/main/ae/`, `src/renderer/src/ae/`, `src/shared/ae/`, `src/cli/specs/ae-*.ts`, `src/cli/handlers/ae-*.ts`, `skills/ae-*`, `skill-guides/ae-*.md`, `skill-stubs/ae-*.md`, `docs/pod/`.
- Every edit to an upstream file is one line where possible and is listed in `FORK_TOUCHPOINTS.md` (file, anchor, reason). Target: under 40 touched upstream files at Phase 4.
- Branch model: `upstream` remote, `main` = Pod. On each upstream stable tag: `git rebase --onto vNEW vOLD main` in a scratch branch, run typecheck and unit tests, then fast-forward. A scheduled workflow does the rebase dry run daily and opens an issue on conflict.
- Versioning: Pod has its own line (`0.1.0`, `0.2.0`, ...); `src/shared/brand.ts` records the upstream base tag and the About dialog shows "Pod 0.3.0 (Orca v1.4.197)". Reason: `src/shared/app-version.ts` discards `+build` metadata and treats `-x` as a prerelease, so an upstream-derived version string would either collide or sort wrongly.
- CLI name stays `orca` in v1. Skills, the worker preamble and hook env all reference it; renaming is a Phase 4 candidate. Document that Pod and stock Orca should not both register the CLI.
- Upstream PR candidates, kept as isolated commits: `toolCmdOverrides` for non-agent binaries; folder-workspace coordinator creation path; team-scoped run listing. Orca has no CLA and accepts community PRs.
- Licences: Pod stays MIT. New deps must be MIT/Apache/BSD: `@xyflow/react` (MIT), `@dagrejs/dagre` (MIT), `vscode-jsonrpc` (MIT), `jinja-sql` grammar from samuelcolvin/jinjahtml-vscode (MIT), `@modelcontextprotocol/sdk` (MIT, later). sqlglot (MIT) runs as a Python sidecar, never bundled. dbt and omni are user-installed.

## Phase 0: bootstrap, build, rebrand, sync job

Goal: `pnpm dev` runs Pod locally; CI produces an unsigned DMG that auto-updates from `saiemamer/pod` releases; the daily upstream-drift job is green.

Prerequisites on this Mac: Node 24 via fnm or nvm; `corepack enable && corepack prepare pnpm@12.0.0 --activate`; Xcode Command Line Tools; Python 3. Later: `dbt-core` + `dbt-bigquery` in a venv, the `omni` CLI, `sqlglot`.

Add:
- `FORK_TOUCHPOINTS.md`, `docs/pod/README.md` (what Pod is, install, sync procedure).
- `src/shared/brand.ts`: product name, appId `io.github.saiemamer.pod`, release repo `saiemamer/pod`, feed URL, tap `saiemamer/homebrew-pod`, `UPSTREAM_BASE_TAG`.
- `.github/workflows/pod-upstream-drift.yml` (cron; reuses `.github/actions/install-node-dependencies`).
- `.github/workflows/pod-release.yml`: trimmed copy of `release-mac-build.yml` on `macos-15`, no signing secrets, uploads DMG + `latest-mac.yml` to `saiemamer/pod` releases.
- `resources/app-icons/pod*.png`, `resources/build/icon.icns`, `Casks/pod.rb`.

Touch (rebrand register, from the source review):
- `config/electron-builder.config.cjs` lines 66 (appId), 153-154 (productName, protocols), 393 and 556 (executableName), 440/545/591/595/618 (artifactName), 462/559 (icon), 587 (maintainer), 641-643 (publish owner/repo), 498 (notarize gate), 512/526 (guard mac native extraResources behind `POD_SKIP_MAC_NATIVE` for local smoke builds).
- `src/shared/release-channel.ts:22-25` (release repos), `src/main/updater/updater-release-feed.ts:206`, `src/main/updater-prerelease-feed.ts:5-6,13,156`, `src/shared/local-build-compatibility-contract.ts:3`, `src/main/macos-tcc-prompt-watch.ts:22-27`, `src/main/macos-press-and-hold-default.ts:45`, `src/shared/agent-feature-install-commands.ts:3` (skills install source), `src/shared/plugins/plugin-marketplace.ts:9-11,119`.
- `.github/workflows/homebrew-bump.yml` (tap), `release-cut.yml` (owner/repo). Delete `cloud-*`, mobile, hourly, daily, adhoc workflows.
- `package.json` name, version `0.1.0`, description.

Reuse: `release-cut.yml` version guard, `config/scripts/verify-macos-entitlements.mjs`, existing `pr.yml` typecheck/test jobs.

Risks: Swift 6 helper cannot build on Ventura (CI-only packaging); GitHub macOS minutes are free only for public repos, so `saiemamer/pod` should be public; verify PostHog stays null with no key; the Windows SignPath sponsorship does not transfer (no Windows build in v1).

Verify: `pnpm install`, `pnpm dev` opens Pod with the new name and icon; `pnpm tc`; `pnpm test src/shared/release-channel*.test.ts`; drift job passes on the current tag; DMG from CI installs, then publishing `0.1.1` triggers an in-app update.

### Phase 0 outcome (2026-09-07)

Built as planned with four changes of approach, each forced by a rebase rehearsal:

- `package.json` keeps upstream's `name` and `version`. Upstream bumps the version line in every release, so a committed Pod version conflicted on every rebase; `pod-release.yml` stamps `0.x.y` from the tag at build time instead.
- Upstream workflows are moved to `.github/workflows-upstream/`, not deleted, so their frequent upstream edits apply through rename detection. `src/shared/brand.test.ts` fails when a rebase drops a new upstream workflow into the live folder.
- `README.md` is kept by the `pod-keep` merge driver declared in `.gitattributes`, which has to sit in the first Pod commit because git reads attributes from the tree being rebased onto.
- The skills-repository URL touch is deferred to Phase 1; it cost seven excluded test files for no Phase 0 benefit.

A local forward rebase onto upstream `main`, 405 commits past v1.4.197, applied all touchpoints cleanly. Releases 0.1.0 to 0.1.3 built in about eight minutes each; 0.1.0 and 0.1.1 shipped with a second hardcoded updater feed (Orca's) and a CLI wrapper that assumed an executable named Orca, both fixed in 0.1.2 and now guarded by `src/shared/brand.test.ts` and a packaged-app check in `pod-release.yml`. Unsigned builds can see and download updates but macOS will not install them in place (Electron: "Your application must be signed for automatic updates on macOS"), so company-wide auto-update needs a Developer ID before Phase 4.

Distribution decision (2026-09-07, Saiem): updates go through Homebrew. The cask lives in `saiemamer/homebrew-pod`, whose `bump.yml` follows Pod's releases (every 30 minutes, or on dispatch) and rewrites version and checksums; users run `brew install --cask saiemamer/pod/pod` once and `brew upgrade --cask pod` to update. Packaged macOS Pod reports releases as externally managed (`POD_MAC_UPDATES_VIA_BREW`), so the update card names the brew command instead of offering a download that unsigned builds cannot install. Signing remains the path to true in-place updates; flip the flag when it lands. Test releases 0.1.0 and 0.1.1 were deleted; 0.1.2 to 0.1.4 stand.

Branding pass (2026-09-07, 0.1.5): instead of editing hundreds of strings, `translate()` in the renderer and `translateMain()` in the main process pass every resolved string through `rebrandProductName` (`src/shared/pod/brand-text.ts`), which turns Orca into Pod except for Orca-operated names (Orca Mobile, Orca Cloud, Orca Relay, accounts, the star nag). The hook is off under vitest so upstream tests keep their assertions; `brand-text.test.ts` covers the rule. The window title, the landing logo (`resources/logo.svg`) and two raw main-process titles are direct touches. Signing is deferred indefinitely on Saiem's decision; the update card now carries an "Update with Homebrew" button that opens a `.command` file in Terminal. On Saiem's request (2026-09-07) Orca Mobile, Orca Cloud accounts and Orca Relay are hidden behind `POD_SHOW_ORCA_CLOUD_FEATURES` (five one-line gates; the flag is true under vitest so upstream tests still cover those surfaces) rather than removed, so they can return later. Pod CI runs `src/**` tests only through `config/vitest.pod.config.ts`; the excluded upstream files are listed there with reasons.

Spike results:

- Build: Orca builds and runs with `pnpm dev` on macOS 13 using the Node 24 tarball, without the Swift helper.
- LSP: j-clemons/dbt-language-server v0.4.2 publishes raw binaries named `dbt-language-server-darwin-arm64`, `dbt-language-server-darwin-amd64` and `dbt-language-server-linux-amd64`. Completions against a Core project are still untested.
- Folder coordinator (from source, not yet exercised live): `orca orchestration run-create` works from a folder-workspace terminal (`src/main/runtime/rpc/methods/orchestration-runs.ts:31-50` needs only a stable pane). `worker-start --worktree new-top-level --repo id:<x>` fails with a bare `selector_not_found`, because `orchestration-workers.ts:83-86` calls `showManagedWorktree('id:folder:<id>')` unconditionally and `resolveWorktreeSelector` has no `folder:` branch, even though `new-top-level` never uses the coordinator worktree (`orchestration-worker-topology.ts:150-153`). The two-step fallback works today: `orca worktree create --repo id:<x> --parent-worktree folder:<id>` is a documented path (`src/cli/specs/core.ts:132`), and `worker-start --worktree id:<new>` skips the lookup. The one-line fix at `orchestration-workers.ts:85` (resolve through `showManagedTerminalWorkspace`, or skip the lookup when `--repo` is explicit and placement is `new-top-level`) is the first upstream PR candidate.
- sqlglot 30.18 on a local copy of dbt-analytics (2,203 models, BigQuery): `migration_opportunities` (17 CTEs, UNION, UNNEST), `zendesk_tickets_history` (22 CTEs) and `zendesk_tickets_latest_update` (11 CTEs, UNNEST) all parse after a crude Jinja substitution of `ref`/`source`. `lineage()` reaches the source tables on its own and resolves to `(table, column)` pairs for 31 of 53 output columns once the referenced models' projections are passed as `schema`; the rest stop at `*` where a `select *` chain ends in a source with no column list. So Pod must feed catalog or manifest columns as the schema and run on `dbt compile` output, as planned; the crude renderer is not a substitute.

## Phase 1: settings, team model, cross-repo orchestration

Goal: a Team with two repos, an Initiative whose coordinator dispatches one worker into each repo, tool binaries configured in Settings.

Add:
- `src/shared/ae/team-types.ts` (`AeTeamConfig`, `AeInitiative`, repo roles), `src/shared/ae/dbt-settings-types.ts` (`AeDbtSettings`: `showLimit` 500, `target`, `profilesDir`, `projectDir`, `env`, `envFile`, `parseOnLoad` true, `lineageDepth` 4, `lineageTreeDepth` 8, `lineageMaxNodes` 500, `distribution` `core`, `coreAdapter` `bigquery`).
- `src/main/persistence/loading-store/ae-team-persistence.ts` (new domain, normalises `aeTeams` and `aeInitiatives`).
- `src/main/ipc/ae/ae-team-handlers.ts` modelled on `src/main/ipc/repos/project-group-handlers.ts:18-49`; `src/preload/api/ae-teams-bridge.ts`; `src/renderer/src/store/ae/ae-team-slice.ts`.
- `src/main/ae/team-env.ts`: merges team tool env and safeStorage secrets (`OMNI_BASE_URL`, `OMNI_API_KEY`, dbt env) into the agent launch env by repo role; secrets via `src/main/host/electron-secret-store.ts`.
- `src/main/ae/initiative-service.ts`: creates the initiative folder + `INITIATIVE.md`, registers the folder workspace under the team group, records the run id once the coordinator creates it (hook: `runtime.onWorktreeLifecycle` and `orchestration.runCreate` observer).
- Settings UI: `src/renderer/src/components/settings/AeToolsPane.tsx` (dbt and omni binary paths with a file picker, copy of `AgentCommandOverrideInput` in `AgentLaunchDefaultsEditor.tsx`), `AeDbtPane.tsx` + `ae-dbt-search.ts`, `settings-ae-section-renderers.tsx` modelled on `settings-capability-section-renderers.tsx:11-35`.
- Sidebar: `AeTeamSettingsDialog.tsx`, `AeNewInitiativeDialog.tsx` (pattern: `ProjectGroupNameDialog.tsx`), right-sidebar `AeInitiativePanel.tsx` (template: `FolderWorkspaceWorktreesPanel.tsx`, `folderOnly: true`).
- Skills: `skills/ae-initiative` (coordinator playbook above), `skills/ae-omni` (Omni CLI workflow, branch naming rule from WORKFLOW.md line 332, never edit `omni/` files directly), with guides and stubs; regenerate `src/cli/bundled-skill-guides.ts` and `resources/skills/*.json` via the existing generators.

Touch: `src/shared/global-settings-types.ts:366` (`toolCmdOverrides`, `dbt`), `src/shared/default-global-settings.ts:203`, `src/shared/persisted-state-types.ts` (+2 optional keys), `src/main/persistence/loading-store/store-domain-composition.ts` (+1 domain), `src/preload/index.ts:111`, `src/preload/api-types.ts:76`, `src/renderer/src/store/index.ts`, `src/renderer/src/lib/settings-navigation-types.ts:20-62`, `src/renderer/src/hooks/settings-navigation-capability-sections.ts:65`, `src/renderer/src/components/settings/settings-page-renderer.tsx:117-132`, `src/shared/ui-chrome-types.ts:88-99` (`RightSidebarTab` +`'initiative'`), `src/renderer/src/store/right-sidebar-route.ts:46-53`, `right-sidebar/right-sidebar-panel-content.tsx`, `use-right-sidebar-activity-items.ts:65-112`, `src/main/runtime/runtime-worktree-agent-startup.ts:87,150` (wrap `resolveTuiAgentLaunchEnv` with team env), `src/cli/specs/index.ts:21-40`, `src/cli/handler-group-manifest.ts:14` (for `orca team ...` list/show).

Reuse: `worker-start --repo`, `worktree create --parent-worktree folder:<id>`, `assertOrchestrationWorktreeCreationSupported`, `notifyReposChanged`, i18n `translate()` + `pnpm sync:localization-catalog`.

Risks: whether `showManagedWorktree('id:<folderWorkspaceId>')` throws for a folder coordinator (spike first; the skill has the two-step fallback); `new-child --repo <other>` may record a cross-repo lineage edge that gets filtered, so always use `new-top-level`; max-lines ratchets at 300/400/600 (`.oxlintrc.json:160-172`); localization gates for new strings.

Verify: vitest round-trip of `aeTeams`/`aeInitiatives` through the loader; RPC harness test (`rpc-test-harness.ts`) creating a run from a folder terminal and dispatching into two fixture repos; Playwright: team header → New initiative → coordinator terminal opens with the prefilled prompt; manual: Claude Code in the initiative folder runs the playbook end to end on two throwaway repos.

### Phase 1 outcome (2026-09-07)

Built as planned, with the vocabulary decision applied (`Domain`, `orca domain ...`, `aeDomains`) and three changes of shape:

- No `initiative-service` hooks on `runtime.onWorktreeLifecycle` or an `orchestration.runCreate` observer. The main agent records its run with `orca domain initiative-update --initiative "$POD_INITIATIVE_ID" --run <run_id>`, and `AeDomainService` emits a change event that the IPC layer forwards as `ae:changed`, so the panel refreshes whichever door the write came through (IPC, CLI RPC, launchers).
- Secrets live in the persisted store as base64 `safeStorage` ciphertext (`aeDomainSecrets`) rather than in `electron-secret-store`; names only leave the main process.
- The Domain settings and New initiative dialogs mount from store state (`aeDialog`) outside the Radix menu, because `DropdownMenuContent` unmounts on select.

Touch count for Phase 1: 24 upstream files, all one line where the file allowed it (`FORK_TOUCHPOINTS.md`, Phase 1 table). Two of them exist only to satisfy upstream ratchets: `client-ui-schemas.ts` (the ui.set tab schema is type-checked against `RightSidebarTab`) and the `providesInitialSurface` census test (every file under `src/` that mentions the flag must be listed, so Pod keeps one mention in `reveal-folder-workspace.ts`).

End to end, run on 2026-09-07 against `pnpm dev` with two throwaway repos in `~/Projects/pod-smoke` (`dbt-demo` with `dbt_project.yml`, `omni-demo` with `model.yaml`), scripted with Playwright over the dev instance's CDP port (`docs/pod/smoke/ui-smoke.mjs`):

1. Import the folder as a project group, open Domain settings from the group menu, Detect roles (dbt, omni), Save. New initiative "Smoke initiative" for Channels: `initiatives/smoke-initiative/INITIATIVE.md` written, folder workspace created under the group, Claude Code opened there with the drafted prompt, Initiative tab showing title, status, repos, folder and run.
2. As the main agent (commands issued with `--from <coordinator handle>` from a shell; inside the Orca terminal `ORCA_TERMINAL_HANDLE` supplies it): `run-create`, `initiative-update --run`, two `task-create` with the Omni task depending on the dbt task, two-step dispatch (`worktree create --parent-worktree folder:<id>`, then `worker-start --worktree id:<wt> --agent claude`), `check --wait --types worker_done,escalation`. Three Claude Code workers completed their tasks (commits on `smoke-dbt`, `smoke-omni`, `smoke-dbt-2`), the Omni task turned `ready` on its own when the dbt task completed, and the Initiative panel listed the tasks with status and worker handle.

What the run taught, now in the `ae-initiative` guide:

- `worker-start --agent claude` opens the worker's own terminal, waits for readiness and delivers the task. Passing `--agent` to `worktree create` as well leaves a second Claude sitting at its trust prompt; the guide creates the worktree without an agent.
- `check --wait` returns the oldest unacknowledged batch until `--ack <deliveryId>` is passed.
- Claude Code keys its trust prompt to the repo's main worktree path, so it appears once per repo (and the bypass-permissions acceptance once per machine); later worktrees start clean.
- On a machine with Pod installed from Homebrew, a `pnpm dev` worker's `orca` resolves to the installed build, which at 0.1.6 predates the `ae-*` skills. `orca-dev` is the dev wrapper. Irrelevant once 0.1.7 ships.

Released as v0.1.7 on 2026-09-07 (release run green, `pod-macos-arm64.dmg` and `pod-macos-x64.dmg` published, tap cask bumped to 0.1.7 the same afternoon).

Still open after Phase 1: the folder-coordinator `worker-start --worktree new-top-level` fix upstream (the two-step path is the documented one); signing (deferred by decision); a Playwright check in CI (the smoke script runs by hand against a dev instance).

## Phase 2: dbt language, LSP, results, compiled SQL, discovery, agent tools

Goal: open a model in a dbt project, get Jinja-aware highlighting and LSP, press Cmd+Enter, see rows; agents can call the same operations through `orca dbt ...`.

Add:
- `src/renderer/src/lib/monaco-languages/register-jinja-sql.ts` + `textmate-grammars/jinja-sql.tmLanguage.json` (MIT grammar), registered via `registerTextMateLanguage`.
- `src/main/ae/dbt/dbt-project-discovery.ts` (nearest ancestor `dbt_project.yml` within the worktree, `projectDir` override), `dbt-profiles-search.ts` (`local_profiles/`, `profiles/`, `.dbt/`, else let dbt resolve), `dbt-env-file.ts` (`.env`/`.env.local` from repo root down to project dir, real env wins, explicit `envFile` last, values never logged), `dbt-runner.ts` (`runProcess` from `src/shared/child-process/`, cwd = project root, `--target`, `--profiles-dir`, bounded output, timeout), `dbt-show-output.ts` (Core `{"show": [...]}` and Fusion bare array), `dbt-catalog-refresh.ts` (`dbt parse` then `dbt docs generate` for Core, `dbt compile --write-catalog` for Fusion, once per project per session when `parseOnLoad`).
- `src/main/ae/dbt/dbt-lsp-bridge.ts` (spawns `dbt-language-server` for Core or `dbt lsp` for Fusion, `vscode-jsonrpc` framing, never sends `workspace/didChangeConfiguration`), `dbt-lsp-download.ts` (GitHub release asset for darwin-arm64/amd64, stored under userData, pruned).
- `src/renderer/src/ae/dbt/dbt-lsp-client.ts` (Monaco completion, hover, definition, diagnostics via `setModelMarkers`), `dbt-ref-navigation.ts` (Cmd-click on `ref('x')` resolves `models/**/x.sql` by file scan; CTE name jump in-buffer; no LSP round trip).
- `src/renderer/src/ae/dbt/DbtResultsSurface.tsx` (editor-area tab with Table, Compiled, Lineage, Connection inner tabs), `DbtResultsGrid.tsx` (virtualised with `@tanstack/react-virtual` as in `CsvViewer.tsx`; sort, search, hide columns, resize, cell detail, CSV export of the displayed rows to `target/<model>_results.csv`), `DbtCompiledView.tsx` (read-only Monaco, `jinja-sql`).
- `src/main/ipc/ae/dbt-handlers.ts`, `src/main/runtime/rpc/methods/ae-dbt.ts`, `src/cli/specs/ae-dbt.ts`, `src/cli/handlers/ae-dbt.ts`: `orca dbt list-models | model-info | lineage | column-lineage | show | compile --json` (same six operations as dbt-zed's MCP tools; `show` warns it queries the warehouse; limit clamped 1..500).
- `skills/ae-dbt` (when to call which command; never paste credentials).
- `src/shared/keybindings/definitions-ae.ts`: `dbt.runSelection` = Cmd+Enter in `jinja-sql` editors.

Touch: `src/renderer/src/lib/monaco-setup.ts:80`, `src/renderer/src/lib/language-detect.ts:76` (`.sql` → `jinja-sql` when inside a discovered dbt project), `src/shared/tab-types.ts:20-28`, `src/renderer/src/store/slices/editor/types/open-file.ts:147`, `components/editor/EditorContent.tsx:122`, `EditorPanel.tsx:283`, `store/slices/editor/tabs/editor-tab-content-type.ts`, `src/shared/keybindings/types.ts:86-88`, `src/shared/keybindings/definitions.ts`, `MonacoEditor.tsx` (action registration), IPC and RPC method indexes, CLI spec index and handler manifest.

Reuse: `registerTextMateLanguage`, `runProcess`/`spawnProcess`, `CsvViewer.tsx` virtualisation and `csv-parse.ts`, `keybinding-file.ts`, bundled-skill generators, `cli-command-name-parity.test.ts`.

Risks: `monaco-languageclient` couples to a vscode-api shim and Orca pins `monaco-editor ^0.55`, hence the hand-wired client; the Go LSP's release asset names must be confirmed at implementation; BigQuery `dbt show` costs money, so the default limit stays 500 and the grid shows the limit; a Core `dbt` on PATH has no `lsp` subcommand, so `distribution` decides the server.

Verify: unit tests for discovery order, profiles search, `.env` precedence, show-output fixtures for Core and Fusion; CLI parity tests; Playwright with a fixture dbt project and a stub `dbt` script that prints canned JSON; manual on dbt-analytics-2 with a BigQuery profile.

### Phase 2 progress (2026-09-07)

First slice built and verified, in this order: language, discovery and runner with unit tests, CLI, then UI.

- `jinja-sql` is a TextMate language (`register-jinja-sql.ts`, grammars from samuelcolvin/jinjahtml-vscode and microsoft/vscode-mssql, both MIT). Every `.sql` file uses it: the grammar includes plain SQL, so outside dbt the file still reads as SQL and no discovery round trip is needed when a tab opens.
- `src/main/ae/dbt/`: discovery walks up from the file to the worktree root, then one level down (some repos keep the project in a subfolder), with a settings or domain override; profiles come from settings, `DBT_PROFILES_DIR`, the project or repo (`local_profiles/`, `profiles/`, `.dbt/`, or `profiles.yml` beside the project), `~/.dbt`, else dbt resolves them; `.env` and `.env.local` apply from the repo root down to the project, the real environment beats them, and what someone typed into Pod (domain env, secrets, dbt settings env) beats both. The runner goes through `runProcess` with `--quiet`, colours off, a ten-minute timeout and a 16 MB output cap, serialised per project because dbt Core writes `target/` while it works. `show` parses Core's `{"show": [...]}` and Fusion's bare array; `compile` reads the `CompiledNode` event from `--log-format json`, falling back to the text banner and the compiled file. The manifest reader keeps models, sources and the edge maps in memory, keyed by file mtime, and leaves compiled code on disk.
- `AeDbtService` sits behind IPC (`ae:dbt:*`, registered with the domain handlers) and RPC (`dbt.*`); `orca dbt project|list-models|model-info|lineage|show|compile|parse` is in the `ae-dbt` guide. `column-lineage` waits for the Phase 3 graph rather than shipping as a stub.
- The results dock lives under Jinja SQL editors (`PodDbtDock.tsx`): Cmd+Enter runs the selection inline or the model by file name through `dbt show --output json` with the limit capped at 500, Cmd+Shift+Enter compiles, and the Table, Compiled and Connection tabs share one state per open file in the Pod store slice. Both shortcuts are keybinding definitions (`definitions-ae.ts`), so they show in Settings and can be rebound. A new editor tab mode was rejected: `'check-details'` is special-cased in 32 renderer files, while the dock is one line in `EditorEditFileSurface.tsx`.
- Verified with unit tests for every module (a shell script stands in for dbt in the service test) and with `docs/pod/smoke/ui-dbt-smoke.mjs` against `pnpm dev`, which drove all three tabs with the stand-in `dbt-stub.sh`. No real dbt or warehouse exists on this Mac, so the BigQuery run against dbt-analytics is still to do.

Second slice (2026-09-07 night), in this order: LSP download and bridge with unit tests, catalog refresh, ref navigation, grid tools, dock handle, then the Playwright smoke.

- Language server: `dbt-lsp-download.ts` pins j-clemons/dbt-language-server v0.4.2 (MIT, Go) with a sha256 and size per asset (darwin-arm64, darwin-amd64, linux-amd64), fetches it through the main HTTP client into `<userData>/pod/dbt-language-server/<version>/` on first use and prunes other versions. `dbt-lsp-bridge.ts` talks LSP over stdio with `vscode-jsonrpc` (initialize with rootUri = project dir, didOpen, whole-document didChange, didClose, completion, hover, definition, publishDiagnostics; never sends `workspace/didChangeConfiguration`; ten-second request timeout; the real exit code and stderr tail reach the caller). `dbt-lsp-service.ts` runs one server per project: it starts when the first Jinja SQL editor in that project opens, stops five minutes after the last one closes, and picks the binary in the order settings (`toolCmdOverrides.dbtLsp`) > download > PATH. With `distribution: fusion` the server is started with `--fusion=<dbt path>`, which its README documents as the way to get Fusion's static analysis back as diagnostics; the plan's `dbt lsp` idea was dropped because no such subcommand is documented. Renderer side, `dbt-lsp-client.ts` registers Monaco completion, hover and definition providers for `jinja-sql`, syncs documents (debounced 200 ms), maps diagnostics to markers, and installs an editor opener that opens go-to-definition targets as preview tabs in the source file's worktree. What v0.4.2 answers on the smoke project: completion for models inside `ref('`, definition for refs, hover text only for `var()`; hover on a ref is empty and diagnostics only arrive with Fusion.
- `ref()` navigation: `dbt-ref-navigation.ts` parses `ref()`, `source()` and CTE names at the cursor; `ae:dbt:resolveRef` scans the project's model paths for `<name>.sql` and lets the manifest's `original_file_path` pick between packages; a CTE name jumps in-buffer; anything else falls through to the language server. Cmd-click works before any server is up.
- Catalog: `ensureCatalog` runs `dbt parse` then `dbt docs generate` (Fusion: `compile --write-catalog`) once per project per session when `parseOnLoad` is on, triggered when a Jinja SQL editor becomes active; the Connection tab shows Catalog and Language server rows with Refresh catalog and Restart language server buttons. On BigQuery `docs generate` queries INFORMATION_SCHEMA per dataset, so the setting exists to turn it off.
- Grid: header click sorts ascending, descending, off (numbers numerically, text case-insensitively, NULL last both ways); a search box filters on every shown cell; a Columns menu hides columns; header edges drag to resize; Export CSV writes the shown rows and columns to `target/<label>_results.csv` and toasts the path. The dock has a drag handle on its top edge; the height is shared by every dock and kept in localStorage.
- Settings: a Language server switch on the dbt page and a dbt-language-server path on the Analytics Tools page.
- Verified: unit tests for download (fake fetch, hash and size checks, prune), bridge and service (a Node script under `__fixtures__/` plays the server), catalog ledger, ref scan, CSV, grid state and ref parsing; `docs/pod/smoke/ui-dbt-smoke.mjs` steps 6 to 10 against `pnpm dev` with the real v0.4.2 binary downloaded live: completion popup showing `stg_orders · Project: demo`, Cmd-click opening `stg_orders.sql`, sort, search, hidden column, export, drag handle.
- `pnpm typecheck:pod` (`config/pod-typecheck-changed.mjs`) typechecks only the changed files and their imports. A cold `pnpm typecheck:web` needs more than 3 GB of heap on this 8 GB Mac and dies; CI still runs the full check.

Still open in Phase 2: Fusion output checked against a real binary (the `--fusion` diagnostics path and `compile --write-catalog`); the ae-dbt skill's `orca dbt` commands exercised by a worker; a real BigQuery run; hover for `ref()` once the language server offers it.

## Phase 3: lineage canvas, column lineage, database explorer

Goal: the lineage view from the zdbt screenshot, column click lights up the transformation path, plus a Database tree and a Connection tab.

Add:
- `src/shared/ae/dbt/manifest-graph.ts`: nodes from `manifest.json` (`model`, `seed`, `snapshot`, `source`), edges from `parent_map`, columns from `catalog.json` ordered by index, else manifest column docs, else parsed select list; nodes with no columns inherit parents' columns to a fixpoint (max 10 passes); cache keyed on manifest and catalog mtimes; stored in memory (no sqlitegraph).
- `src/main/ae/dbt/column-lineage.ts`: primary engine is a Python sidecar `resources/ae/sqlglot_lineage.py` (sqlglot `lineage()` with `dialect="bigquery"`, upstream column lists passed as schema) run through `runProcess`; fallback is name matching on parsed select entries when Python or sqlglot is missing. Highlight propagation over the graph both directions, capped at 16 passes.
- `src/renderer/src/ae/lineage/LineageCanvas.tsx` (`@xyflow/react`), `lineage-layout.ts` (`@dagrejs/dagre` left-to-right, rank by longest path, barycenter ordering), `LineageNode.tsx` (materialisation colour, column rows above zoom 0.55, collapse up/down, expand-depth handle), `LineageTree.tsx` (upstream/downstream tree with truncation flags), controls Upstream, Downstream, Columns, Arrange, zoom.
- `src/renderer/src/ae/dbt/DbtExplorerPanel.tsx` (Database → Schema → Relation → Column from catalog.json; right sidebar tab) and `DbtConnectionTab.tsx` (project, binary and where it came from, profile, target, parameter names only; values are dropped at parse time).
- CLI: `orca dbt lineage` and `column-lineage` get real data from the graph service.

Touch: none beyond Phase 2 (Lineage and Connection are inner tabs; the explorer reuses the right-sidebar registration from Phase 1 with a `gitOnly` item).

Risks: sqlglot coverage on real BigQuery models (STRUCT, UNNEST, QUALIFY) is the best available but not perfect, so the fallback and the "resolved vs name-matched" badge matter; large manifests (depth caps and `lineageMaxNodes` enforced before layout; lazy-load the canvas bundle); Python availability (settings show which engine is active).

Verify: graph tests on fixture `manifest.json` and `catalog.json` (edges, three-phase columns); lineage fixtures with expected `(node, column)` pairs; layout snapshot tests; Playwright for collapse, depth expansion and column focus; manual on the 49-model OpenCX subgraph.

## Phase 4: Omni panel, company distribution, upstream PRs

Add:
- `src/main/ae/omni/omni-runner.ts` (binary from `toolCmdOverrides.omni`, env from team secrets), `omni-branches.ts` (`omni models list`, `create-branch`, `validate`, `commit`, JSON output), `src/renderer/src/ae/omni/OmniPanel.tsx` (model branches for the worktree, validate output, topic browser via `list-topics`/`get-topic`), CLI `orca omni validate | branch | commit --json`.
- Optional standalone `packages/pod-dbt-mcp` (same six tools over `@modelcontextprotocol/sdk`) for agents outside Pod; registered through `agentDefaultArgs.claude` `--mcp-config <userData>/pod-mcp.json`, never by writing into worktrees.
- Homebrew tap repo `saiemamer/homebrew-pod`; `docs/pod/install.md` with the right-click-Open first-launch note; `docs/pod/sync.md`.
- Upstream PRs from isolated commits: `toolCmdOverrides`, folder-coordinator creation support.

Touch: right-sidebar tab union (+`'omni'`), `Casks/pod.rb`, `homebrew-bump.yml`.

Verify: `omni models validate` fixture parsing; `brew install --cask saiemamer/pod/pod`; update across an upstream bump (Pod 0.4.0 on Orca vA → 0.5.0 on vB) keeps teams, initiatives and settings.

## Out of scope for v1

Windows and Linux builds; signed macOS builds (add when a Developer ID exists: `MAC_CERTS`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in `release-mac-build.yml:78-82`); renaming the `orca` CLI; the mobile app and cloud relay; bundling dbt, omni or Python; SSH-host execution of dbt (design keeps dbt on the host that owns the repo so it can follow later).

## End-to-end verification (after Phase 3)

1. Fresh install of the DMG on a colleague's Mac (right-click Open), set `dbt` and `omni` paths in Settings → Tools.
2. Import `~/teams/mex` as a Team; both repos appear under it.
3. Open a model in dbt-analytics-2: highlighting, hover, Cmd-click on `ref()`, Cmd+Enter returns rows from BigQuery, Compiled tab shows the rendered SQL, Lineage tab centres the model, clicking a column highlights its path.
4. New Initiative "OpenCX migration": coordinator dispatches two dbt workers and, after `worker_done`, one omni worker; the Initiative panel shows all three with their worktrees; the omni worker's branch name matches its Omni model branch.
5. Publish a new Pod release; the running app updates itself.
6. Rebase onto the next upstream tag; `pnpm tc && pnpm test` pass; touched-file count in `FORK_TOUCHPOINTS.md` unchanged.

## Spikes to run first (Phase 0, half a day each)

- Build Orca unmodified with Node 24 / pnpm 12 on this Mac and confirm `pnpm dev` runs without the Swift helper.
- From a folder-workspace terminal, run `orca orchestration run-create` and `worker-start --worktree new-top-level --repo id:<other>`; record whether the folder coordinator needs the two-step fallback.
- Confirm the j-clemons LSP release asset names and that it serves completions for a Core project without Fusion.
- Confirm sqlglot lineage on three real dbt-analytics-2 models (a CTE chain, a UNION, a STRUCT access).

## Rough effort

| Phase | Estimate (part-time, Claude Code assisted) |
|---|---|
| 0 | 1 week |
| 1 | 2 weeks |
| 2 | 2-3 weeks |
| 3 | 2-3 weeks |
| 4 | 1-2 weeks |

Estimates, not commitments; Phase 2 and 3 carry the most unknowns (LSP client, sqlglot coverage).
