# Fork touchpoints

Pod is a thin fork of Orca. New code lives in additive directories (`src/main/ae/`, `src/renderer/src/ae/`, `src/shared/ae/`, `src/cli/{specs,handlers}/ae-*.ts`, `skills/ae-*`, `docs/pod/`) and never conflicts on rebase. This file lists every upstream file Pod edits, so a rebase conflict can be resolved by re-applying a known one-line change rather than by archaeology.

Rules:

- One line per touch where possible. Import from `src/shared/brand.ts` (or `config/pod-brand.cjs` in CommonJS) instead of pasting a value.
- Add a row here in the same commit as the touch.
- Rebase, never merge, onto upstream stable tags: `git rebase --onto vNEW vOLD main`. Update `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts` in the same commit.

## Phase 0: identity, updates, release pipeline

| Upstream file | Touch | Reason |
|---|---|---|
| `package.json` | `test:pod` and `typecheck:pod` scripts; `vscode-jsonrpc` in `dependencies` | Runs vitest with `config/vitest.pod.config.ts`; typechecks changed files with `config/pod-typecheck-changed.mjs`; the LSP bridge's framing library (pinned, MIT). `name`, `version` and `bin` stay upstream's: the version line changes every release and would conflict, so `pod-release.yml` stamps Pod's `0.x.y` from the tag at build time. |
| `resources/darwin/bin/orca` | `ELECTRON=` reads `CFBundleExecutable` from `Info.plist` | electron-builder names the binary after `productName`, so `Pod.app/Contents/MacOS/Pod`; the upstream wrapper assumed `Orca` and the bundled `orca` CLI could not start. Upstream PR candidate. |
| `config/electron-builder.config.cjs` | `appId`, `productName`, mac `executableName`, mac `artifactName`, publish `owner` / `repo` read from `config/pod-brand.cjs` | Bundle identity, `pod-macos-<arch>.dmg`, publish to `saiemamer/pod`. |
| `src/shared/release-channel.ts` | four release-repo constants read `POD_RELEASE_REPO` | All channels point at Pod's releases; Pod publishes no hourly/daily builds. |
| `src/main/updater/updater-setup.ts` | `setFeedURL` URL built from `POD_RELEASES_URL` | The initial electron-updater feed. Missed in the first pass, so the 0.1.0 and 0.1.1 builds checked Orca's feed; `src/shared/brand.test.ts` now fails if any updater source contains `stablyai/orca`. |
| `src/main/updater-events.ts` | `externallyManaged` also set when `isBrewManagedPodInstall()` (Pod-owned `src/main/pod/brew-managed-install.ts`) | Unsigned macOS builds cannot replace themselves, so the update card offers no Update button and points at Homebrew. Gated by `POD_MAC_UPDATES_VIA_BREW` in `brand.ts`; flip it when releases are signed. |
| `src/renderer/src/components/maintenance/update-card/UpdateAvailableCardContent.tsx` | externally-managed note takes `brewUpgradeScript` and renders an "Update with Homebrew" button that opens the `.command` file | Unsigned macOS builds hand the upgrade to Homebrew in Terminal with one click. |
| `src/renderer/src/i18n/i18n.ts` | `translate()` passes its result through `rebrandProductName` (Pod-owned `src/shared/pod/brand-text.ts`) outside tests | One hook renames Orca to Pod in every renderer string and translation; Orca-operated names (Orca Mobile, Orca Cloud, Orca Relay, accounts, the star nag) stay. Tests see upstream text, and `brand-text.test.ts` covers the rule. |
| `src/main/i18n/main-i18n.ts` | `translateMain()` does the same outside vitest | Menu, tray, notifications and dialogs that go through the main catalog. |
| `src/renderer/index.html` | `<title>Pod</title>` | Window title. |
| `src/main/window/main-window-close-lifecycle.ts` | tray notice title goes through `translateMain` | Raw literal on a common path; the translate hook renames it, and upstream tests still see the literal. |
| `src/main/window/dashboard-popout-window.ts` | popout window title goes through `translateMain` | Same. |
| `src/shared/update-status-types.ts` | optional `podBrewUpgradeScript` on the available state | Additive optional field, wire-compatible. |
| `src/renderer/src/components/maintenance/update-card/UpdateCardStateContent.tsx` | passes `brewUpgradeScript` to both content components | See `UpdateAvailableCardContent.tsx`. |
| `resources/logo.svg` | replaced | Pod mark, used by the landing page, the sidebar help menu and the settings icon. Upstream's file is a wholesale replacement, so a rebase keeps ours unless upstream edits it. |
| `src/renderer/src/components/sidebar/SidebarNav.tsx` | `shouldShowMobileButton` also requires `POD_SHOW_ORCA_CLOUD_FEATURES` | Hides the Orca Mobile sidebar item and its page. |
| `src/renderer/src/hooks/settings-navigation-capability-sections.ts` | `orca-account` and `mobile` sections require the flag | Hides the Orca Account and Mobile settings pages; the settings framework drops a pane whose entry is gone, deep links included. |
| `src/renderer/src/hooks/settings-navigation-remote-sections.ts` | `servers` section is a conditional spread on the flag | Hides Remote Orca Servers (Orca Relay). SSH Hosts stays. |
| `src/renderer/src/components/settings/AppearanceWindowSidebarSection.tsx` | "Show Orca Mobile Button" toggle wrapped in the flag | Appearance settings. |
| `src/main/menu/register-app-menu.ts` | "Show Orca Mobile Button" menu item is a conditional spread on the flag | App menu. |
| `src/main/updater/updater-release-feed.ts` | fallback feed URL built from `POD_RELEASES_URL` | electron-updater fallback feed. |
| `src/main/updater-prerelease-feed.ts` | atom URL, download base, tag regex, asset-host check built from `POD_RELEASES_URL` | Prerelease fallback feed. |
| `src/shared/local-build-compatibility-contract.ts` | `appId` from `POD_APP_ID` | Local-build contract keyed by bundle id. |
| `src/main/macos-tcc-prompt-watch.ts` | responsible-identifier set derived from `POD_APP_ID` | TCC prompt attribution for Pod's bundle ids. |
| `src/main/macos-press-and-hold-default.ts` | bundle id from `POD_APP_ID` | `defaults write` target. |
| `src/renderer/src/components/settings/GeneralUpdateSettingsSection.tsx` | version string appends `(Orca <POD_UPSTREAM_BASE_TAG>)` | Settings shows which upstream release Pod is built on. |
| `resources/build/icon.icns`, `resources/build/icon.png`, `resources/icon.png` | replaced | Placeholder Pod icon. |
| `.gitattributes` | new file, `README.md merge=pod-keep` | See `README.md`. |
| `.gitignore` | `!docs/pod/` after the `docs/**` rule | Upstream ignores everything under `docs/` except its own allowlist. |
| `README.md` | replaced | Pod front page. `.gitattributes` gives it the `pod-keep` merge driver so rebases keep Pod's copy without a conflict; upstream's README stays readable at `docs/readme/`. |
| `.github/workflows/*` | moved to `.github/workflows-upstream/` | GitHub only runs workflows from `.github/workflows`, and upstream's need Stably's runners and secrets. Moving instead of deleting keeps the files, so upstream edits apply through rename detection on rebase. Pod adds `pod-pr.yml`, `pod-release.yml` and `pod-upstream-drift.yml`; `src/shared/brand.test.ts` fails if a rebase brings a new upstream workflow into the live folder. |

Deferred to Phase 1: `src/shared/agent-feature-install-commands.ts` (skills repository URL), needed once `ae-*` skills exist so `npx skills add` can fetch them; it costs seven excluded test files, so it waits.

Raw "Orca" literals that bypass both translate layers and were left alone: crash-recovery prompts (`renderer-recovery-prompt.ts`, `gpu-fallback-*.ts`), the Codex handshake client title, shell-wrapper header comments, and diagnostics text. Remaining `stablyai/orca` and `com.stablyai.orca` literals in non-test sources, reviewed 2026-09-07 and left alone: GitHub links in the UI (star nag, feedback dialog, support section, feature requests, terminal error toast) point at upstream, where most bugs belong; Orca Mobile APK links; the plugin marketplace; CLI example strings; `orca-star.ts`; `notification-system-settings-link.ts` and `dev-instance-identity.ts` bundle ids (macOS notification-settings deep link and Windows app-user-model id, both cosmetic); the Computer Use helper bundle id, which matches the helper Pod ships unchanged. Re-run `grep -rn 'stablyai/orca\|com.stablyai.orca' src --include='*.ts' --include='*.tsx' | grep -v .test.` after each rebase.

Left deliberately untouched: the app data directory (`~/Library/Application Support/orca`, shared with stock Orca because Electron names it after `package.json`'s `name`; separating it means a `productName` line next to the conflict-prone `version` line, or a startup touch, so it waits until someone needs both apps on one machine), the `Orca: <branch>` label of `pnpm dev` instances (`config/scripts/run-electron-vite-dev.mjs`; packaged builds are named by electron-builder, and `src/main/startup/run-electron-vite-dev.test.ts` asserts the literal), the `orca://` URL scheme and the `orca` CLI name (skills, worker preamble and hook env reference them), `src/shared/plugins/plugin-marketplace.ts` (plugins are off by default), telemetry (`ORCA_POSTHOG_WRITE_KEY` is unset in Pod builds, so no client is created).

## Phase 1: domains, initiatives, tools

| Upstream file | Touch | Reason |
|---|---|---|
| `src/shared/persisted-state-types.ts` | three optional keys `aeDomains`, `aeInitiatives`, `aeDomainSecrets` + type import | Unknown keys already round-trip; the types make the store methods typed. |
| `src/main/persistence/loading-store/store-domain-composition.ts` | import, `StoreDomains` field, class list, install call, constructor, return | Registers `AeDomainPersistence` (Pod-owned `ae-domain-persistence.ts`) like every other domain. |
| `src/main/persistence/loading-store/store.ts` | `AeDomainPersistence` in the `Store` extends list + type import | Makes `store.getAeDomains()` and friends typed. |
| `src/main/ipc/repos.ts` | `registerAeDomainHandlers(mainWindow, store, runtime)` + import | Registers Pod IPC (`ae:*`) and installs the domain service where store and runtime meet. |
| `src/preload/api-types.ts`, `src/preload/index.ts` | `ae: AeApi` / `ae: aeApi` + imports | Preload bridge for domains and initiatives. |
| `src/renderer/src/store/types.ts`, `src/renderer/src/store/index.ts`, `src/renderer/src/store/slices/store-test-helpers.ts` | `AeDomainsSlice` in `AppState`, `createAeDomainsSlice` spread + imports | Renderer store slice; the test helper composes every slice, so it needs the same line. |
| `src/shared/global-settings-types.ts`, `src/shared/default-global-settings.ts` | optional `toolCmdOverrides` and `aeDbt` keys with defaults | Tool paths and dbt defaults; unknown keys already round-trip. |
| `src/renderer/src/components/settings/settings-navigation-foundations.ts` | `tools` group | "Analytics Tools" group in the Settings sidebar. |
| `src/renderer/src/hooks/useSettingsNavigationMetadata.ts` | `...buildPodToolSettingsSections()` after the setup sections | Tools and dbt pages in the navigation. |
| `src/renderer/src/components/settings/settings-page-renderer.tsx` | two render calls + import | Mounts the two panes. |
| `src/renderer/src/lib/settings-navigation-types.ts` | `'tools'`, `'dbt'` targets | Cmd+J and deep links accept the new pages. |
| `src/main/runtime/orca-runtime-resolve-worktree-removal-target.ts` | `agentEnv` spreads `podDomainAgentEnv(workspace)` | Every agent launched in a domain repo or initiative folder gets the domain env, secrets and `POD_*` markers; `{}` outside a domain. |
| `src/main/runtime/runtime-worktree-agent-startup.ts` | same, two sites, from `environment.repo` | Worktree-creating launches, including orchestration workers. |
| `src/main/runtime/orca-runtime-create-agent-session.ts` | same, from `workspace` | Structured agent sessions, which the initiative launcher uses. |
| `src/main/startup/cli-command-names.ts` | `'domain'` in the sorted list | `orca domain ...` top-level name. |
| `src/cli/specs/index.ts`, `src/cli/handler-group-manifest.ts`, `src/main/runtime/rpc/methods/index.ts` | one import and one spread/group each | `orca domain list|show` specs, handlers and RPC methods (Pod-owned `ae-domain.ts` files). |
| `config/scripts/generate-bundled-skill-guides.mjs` | `ae-dbt`, `ae-initiative`, `ae-omni` in the three lists | Bundled skills served by `orca skills get`; the guides and stubs are Pod-owned files under `skill-guides/`, `skill-stubs/` and `skills/`. |
| `src/cli/bundled-skill-guides.ts`, `resources/skills/current-manifest.json`, `resources/skills/snapshot-registry.json` | regenerated | Generated from the lists above; after a rebase run `pnpm run generate:bundled-skill-guides && pnpm run generate:skill-bundle-manifest`. |
| `src/renderer/src/components/sidebar/worktree-list/rows/project-group-header-actions.tsx` | `<PodProjectGroupMenuItems groupId label />` after the Delete group item + import | "Domain settings…" and "New initiative…" in the project group menu. The items only set store state; the dialogs mount elsewhere because Radix unmounts menu content on select. |
| `src/renderer/src/components/sidebar/worktree-list/rows/ProjectGroupDialogs.tsx` | `<PodProjectGroupDialogHost />` in the fragment + import | Mounts `DomainSettingsDialog` or `NewInitiativeDialog` from `aeDialog` in the store. |
| `src/shared/ui-chrome-types.ts` | `'initiative'` in `RightSidebarTab` | The Initiative tab key. |
| `src/renderer/src/store/right-sidebar-route.ts` | `tab === 'initiative'` in the accepted list | Persisted route survives restart instead of falling back to Explorer. |
| `src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx` | lazy import + `{effectiveTab === 'initiative' && <PodInitiativePanel />}` | Renders the panel. |
| `src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts` | `...podInitiativeActivityItems()` after the Ports item + import | Adds the folder-only Initiative tab before plugin tabs, so plugin positions stay stable. |
| `src/main/runtime/rpc/methods/client-ui-schemas.ts` | `'initiative'` in `STATIC_RIGHT_SIDEBAR_TABS` | `ui-state-schema-parity-checks.ts` fails the typecheck when the ui.set schema's tab list is narrower than `RightSidebarTab`. |
| `src/renderer/src/lib/worktree-activation-surface-caller-wiring.test.ts` | `reveal-folder-workspace.ts` in `SURFACE_PROVIDING_CALLERS` | The census fails when any file under `src/` mentions `providesInitialSurface`; Pod keeps a single mention in that helper (the main process opens the agent session, so activation must not seed a shell). |

## Phase 2: dbt language, runner, CLI

| Upstream file | Touch | Reason |
|---|---|---|
| `src/main/startup/cli-command-names.ts` | `'dbt'` in the sorted list | `orca dbt ...` top-level name. |
| `src/cli/specs/index.ts`, `src/cli/handler-group-manifest.ts`, `src/main/runtime/rpc/methods/index.ts` | one import and one spread/group each | `orca dbt project\|list-models\|model-info\|lineage\|show\|compile\|parse` specs, handlers and RPC methods (Pod-owned `ae-dbt.ts` files, `src/cli/ae-dbt-format.ts`). |
| `src/renderer/src/lib/monaco-setup.ts` | `registerJinjaSqlLanguage(monaco)` + import | Registers the TextMate `jinja-sql` language (Pod-owned `monaco-languages/register-jinja-sql.ts`; grammars and licences under `textmate-grammars/`). |
| `src/renderer/src/lib/language-detect.ts` | `'.sql'` maps to `jinja-sql` instead of `sql` | Every .sql file gets the Jinja SQL grammar, which includes plain SQL, so dbt models need no discovery round trip at open time. |
| `src/shared/keybindings/types.ts`, `src/shared/keybindings/definitions.ts` | `'dbt.runSelection' \| 'dbt.compileSelection'` in the action union; `...KEYBINDING_DEFINITION_AE` spread + import | Cmd+Enter and Cmd+Shift+Enter in Jinja SQL editors (Pod-owned `definitions-ae.ts`), rebindable in Settings like every other action. |
| `src/renderer/src/components/editor/EditorEditFileSurface.tsx` | `<PodDbtDock activeFile />` after the editor surface + import | The results dock (Pod-owned `src/renderer/src/ae/dbt/`). A new editor tab mode was rejected: `'check-details'` is special-cased in 32 renderer files. |

The dbt IPC (`ae:dbt:*`, including `ae:dbt:lsp:*` and the `ae:dbt:lsp:event` push channel) registers from `registerAeDomainHandlers`, the dbt and language-server services install there too, and the dock's store slice (`ae-dbt-results.ts`) is composed inside the Pod domains slice, so Phase 2 adds no new IPC or store touch. The language server's Monaco providers, document sync and editor opener are registered from Pod code (`src/renderer/src/ae/dbt/dbt-lsp-client.ts`) on the first dock mount, not from `monaco-setup.ts` or `MonacoEditor.tsx`.

## Pod-owned files outside `ae/`

`src/shared/brand.ts`, `src/shared/brand.test.ts`, `src/shared/pod/brand-text.ts` (+ test), `src/main/updater-pod-release-feed.test.ts`, `src/main/pod/brew-managed-install.ts`, `config/pod-brand.cjs`, `config/vitest.pod.config.ts`, `config/pod-typecheck-changed.mjs`, `docs/pod/`, `.github/workflows/pod-*.yml`, `src/main/ipc/ae/`, `src/cli/ae-*-format.ts`, `src/renderer/src/lib/monaco-languages/register-jinja-sql.ts` (+ test) and the `jinja-sql`, `jinja` and `sql` grammars beside it, this file. They are new files, so they never conflict on rebase.

## Upstream tests Pod does not run

`config/vitest.pod.config.ts` (used by `pnpm test:pod`, `pod-pr.yml` and the drift job) runs `src/**` only and excludes two groups:

- Tests that assert Orca's bundle id, release repository, or feed URLs as literals. Editing them would add a touch per test file that upstream rewrites often; `src/shared/brand.test.ts` and `src/main/updater-pod-release-feed.test.ts` cover the substituted values instead, and upstream CI still runs the originals at the tag Pod is rebased onto.
- `config/scripts/**` and `tests/**`, which are contracts over upstream's workflows, signing and packaging pipeline, plus the one `src/` test that reads `.github/workflows/pr.yml`. Those workflows live in `.github/workflows-upstream/` in Pod; `pod-release.yml` producing an installable DMG is the check that matters.

- Three `src/main/artifacts/artifact-cloud-*.test.ts` files that fail on the untouched upstream tree at v1.4.197. Re-run them after each rebase and drop the exclusion once they pass.

Review the identity list on every rebase: `pnpm test <file>` on an excluded file shows whether it still fails only on identity strings.
