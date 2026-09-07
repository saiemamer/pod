# Developing Pod

Pod is Orca plus an analytics-engineering layer. Read [`PLAN.md`](./PLAN.md) for the architecture and phases, and [`../../FORK_TOUCHPOINTS.md`](../../FORK_TOUCHPOINTS.md) before editing any file outside an `ae/` directory.

## Prerequisites

- Node 24 and pnpm 12. Orca pins both (`engines.node`, `packageManager` in `package.json`). On macOS 13 Homebrew has no Node 24 bottle and compiles for hours; use the official tarball instead:

  ```sh
  mkdir -p ~/.local/node24
  curl -fsSL https://nodejs.org/dist/latest-v24.x/node-v24.x.y-darwin-x64.tar.gz | tar -xz -C ~/.local/node24 --strip-components=1
  PATH=~/.local/node24/bin:$PATH npm i -g pnpm@12.0.0
  export PATH=~/.local/node24/bin:$PATH
  ```

  Pick the exact file name from <https://nodejs.org/dist/latest-v24.x/> (`darwin-arm64` on Apple silicon).
- Xcode Command Line Tools and Python 3 (native module rebuilds).
- For dbt features later: a dbt Core install with `dbt-bigquery`, the `omni` CLI, and `sqlglot`. Their paths are Settings, not build inputs.

Packaging a DMG locally needs Swift 6 (Xcode 16, macOS 14 or newer) for Orca's Computer Use helper. On older machines, run the app with `pnpm dev` and let CI package.

## Run

```sh
pnpm install
pnpm dev
```

`pnpm tc` typechecks, `pnpm test:pod <path>` runs vitest for a path with the Pod exclusions from `config/vitest.pod.config.ts` (plain `pnpm test` also runs the upstream tests that assert Orca's identity strings, which fail by design under Pod branding), `pnpm run check:code-quality:changed` lints changed files. Orca's `AGENTS.md` conventions apply to Pod code too: no `child_process` imports (use `src/shared/child-process/`), no files named `utils` or `helpers`, consider SSH hosts and folder workspaces in every change.

## Rebase onto a new upstream release

The `Pod upstream drift` workflow rehearses this daily and opens an issue when it fails. To do it for real:

```sh
git remote add upstream https://github.com/stablyai/orca.git   # once
git config merge.pod-keep.driver 'cp %B %A'                    # once: keeps Pod's README.md during rebases
git fetch --no-tags --filter=blob:none upstream refs/tags/v1.4.210:refs/tags/v1.4.210
git rebase --onto v1.4.210 v1.4.197 main
# resolve conflicts using FORK_TOUCHPOINTS.md as the guide
# move any new upstream workflow out of .github/workflows (brand.test.ts fails until you do):
#   git mv .github/workflows/<new>.yml .github/workflows-upstream/
pnpm install && pnpm tc && pnpm test:pod src/shared/brand src/shared/release-channel src/main/updater
```

Then bump `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts`, and note the new base in the release notes.

Never push upstream tags to `saiemamer/pod`: `pod-release.yml` builds every `v*` tag, and Pod's own tags are `v0.x.y`. `git push origin main` pushes no tags; avoid `--tags` and `--follow-tags`.

## Cut a release

1. Bump `version` in `Casks/pod.rb` and commit.
2. Tag `v0.x.y` on `main` and push the tag. `package.json` keeps upstream's version; the workflow stamps Pod's from the tag, which is what keeps rebases free of version conflicts.
3. `Pod release (macOS, unsigned)` builds on a `macos-15` runner and publishes the DMG plus `latest-mac.yml` to the tag's GitHub release. Running apps pick it up through electron-updater.

Signing later: add `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repository secrets and set `ORCA_MAC_RELEASE=1` on the package step.
