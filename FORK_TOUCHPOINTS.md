# Fork touchpoints

Pod is a thin fork of Orca. New code lives in additive directories (`src/main/ae/`, `src/renderer/src/ae/`, `src/shared/ae/`, `src/cli/{specs,handlers}/ae-*.ts`, `skills/ae-*`, `docs/pod/`) and never conflicts on rebase. This file lists every upstream file Pod edits, so a rebase conflict can be resolved by re-applying a known one-line change rather than by archaeology.

Rules:

- One line per touch where possible. Import from `src/shared/brand.ts` (or `config/pod-brand.cjs` in CommonJS) instead of pasting a value.
- Add a row here in the same commit as the touch.
- Rebase, never merge, onto upstream stable tags: `git rebase --onto vNEW vOLD main`. Update `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts` in the same commit.

## Phase 0: identity, updates, release pipeline

| Upstream file | Touch | Reason |
|---|---|---|
| `package.json` | `test:pod` script | Runs vitest with `config/vitest.pod.config.ts`. `name`, `version` and `bin` stay upstream's: the version line changes every release and would conflict, so `pod-release.yml` stamps Pod's `0.x.y` from the tag at build time. |
| `resources/darwin/bin/orca` | `ELECTRON=` reads `CFBundleExecutable` from `Info.plist` | electron-builder names the binary after `productName`, so `Pod.app/Contents/MacOS/Pod`; the upstream wrapper assumed `Orca` and the bundled `orca` CLI could not start. Upstream PR candidate. |
| `config/electron-builder.config.cjs` | `appId`, `productName`, mac `executableName`, mac `artifactName`, publish `owner` / `repo` read from `config/pod-brand.cjs` | Bundle identity, `pod-macos-<arch>.dmg`, publish to `saiemamer/pod`. |
| `src/shared/release-channel.ts` | four release-repo constants read `POD_RELEASE_REPO` | All channels point at Pod's releases; Pod publishes no hourly/daily builds. |
| `src/main/updater/updater-setup.ts` | `setFeedURL` URL built from `POD_RELEASES_URL` | The initial electron-updater feed. Missed in the first pass, so the 0.1.0 and 0.1.1 builds checked Orca's feed; `src/shared/brand.test.ts` now fails if any updater source contains `stablyai/orca`. |
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

Remaining `stablyai/orca` and `com.stablyai.orca` literals in non-test sources, reviewed 2026-09-07 and left alone: GitHub links in the UI (star nag, feedback dialog, support section, feature requests, terminal error toast) point at upstream, where most bugs belong; Orca Mobile APK links; the plugin marketplace; CLI example strings; `orca-star.ts`; `notification-system-settings-link.ts` and `dev-instance-identity.ts` bundle ids (macOS notification-settings deep link and Windows app-user-model id, both cosmetic); the Computer Use helper bundle id, which matches the helper Pod ships unchanged. Re-run `grep -rn 'stablyai/orca\|com.stablyai.orca' src --include='*.ts' --include='*.tsx' | grep -v .test.` after each rebase.

Left deliberately untouched: the app data directory (`~/Library/Application Support/orca`, shared with stock Orca because Electron names it after `package.json`'s `name`; separating it means a `productName` line next to the conflict-prone `version` line, or a startup touch, so it waits until someone needs both apps on one machine), the `Orca: <branch>` label of `pnpm dev` instances (`config/scripts/run-electron-vite-dev.mjs`; packaged builds are named by electron-builder, and `src/main/startup/run-electron-vite-dev.test.ts` asserts the literal), the `orca://` URL scheme and the `orca` CLI name (skills, worker preamble and hook env reference them), `src/shared/plugins/plugin-marketplace.ts` (plugins are off by default), telemetry (`ORCA_POSTHOG_WRITE_KEY` is unset in Pod builds, so no client is created).

## Pod-owned files outside `ae/`

`src/shared/brand.ts`, `src/shared/brand.test.ts`, `src/main/updater-pod-release-feed.test.ts`, `config/pod-brand.cjs`, `config/vitest.pod.config.ts`, `Casks/pod.rb`, `docs/pod/`, `.github/workflows/pod-*.yml`, this file. They are new files, so they never conflict on rebase.

## Upstream tests Pod does not run

`config/vitest.pod.config.ts` (used by `pnpm test:pod`, `pod-pr.yml` and the drift job) runs `src/**` only and excludes two groups:

- Tests that assert Orca's bundle id, release repository, or feed URLs as literals. Editing them would add a touch per test file that upstream rewrites often; `src/shared/brand.test.ts` and `src/main/updater-pod-release-feed.test.ts` cover the substituted values instead, and upstream CI still runs the originals at the tag Pod is rebased onto.
- `config/scripts/**` and `tests/**`, which are contracts over upstream's workflows, signing and packaging pipeline, plus the one `src/` test that reads `.github/workflows/pr.yml`. Those workflows live in `.github/workflows-upstream/` in Pod; `pod-release.yml` producing an installable DMG is the check that matters.

- Three `src/main/artifacts/artifact-cloud-*.test.ts` files that fail on the untouched upstream tree at v1.4.197. Re-run them after each rebase and drop the exclusion once they pass.

Review the identity list on every rebase: `pnpm test <file>` on an excluded file shows whether it still fails only on identity strings.
