# Keeping Pod in sync with Orca

Pod's `main` is an upstream Orca stable tag with Pod's commits replayed on top. To take a new Orca release, Pod rebases those commits onto the newer tag; it never merges upstream. The tag Pod sits on is `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts`, and Settings > General shows it after the version, as "(Orca v1.4.197)".

Three things keep a rebase small. Pod's own code lives in new files (`ae/` directories and the others listed in [`FORK_TOUCHPOINTS.md`](../../FORK_TOUCHPOINTS.md)), which never conflict. Every edit to an upstream file is one short touch with a row in that register, so a conflict is resolved by re-applying a known change. And `package.json` keeps upstream's name and version (the release workflow stamps Pod's version from the tag), so upstream's version bump does not conflict.

## Where it stands (2026-10-04)

Pod's `main` has been on Orca v1.4.219 since 2026-10-04; [`sync-log-v1.4.219.md`](./sync-log-v1.4.219.md) records that sync. The old `main`, on v1.4.197, is kept on GitHub as the branch `backup/main-before-v1.4.219`. The daily rehearsal below opened an issue for every stable tag from v1.4.198 to v1.4.219 (issues 2 to 19, [labelled `upstream-drift`](https://github.com/saiemamer/pod/issues?q=label%3Aupstream-drift)); they were closed on 2026-10-04 with a note that Pod is on v1.4.219. The same day the job opened issue 21 for Orca v1.4.220, which stays open.

No Pod release has been built on v1.4.219 yet. `pod-release.yml` needed two new install steps to build on it (see the sync log), and a `mode=trial` run of it, which publishes nothing, has to pass before the next release.

## The sync script

`config/pod-sync-upstream.mjs` does the rebase. It works on the repository in the current directory, reads the base tag from `config/pod-brand.cjs`, fetches only the base and target tags from stablyai/orca (adding the `upstream` remote if it is missing), creates `sync/<tag>` from `HEAD` and runs `git rebase --onto <tag> <base>` there. It refuses a dirty tree, an existing branch, `--branch main`, and a tag older than the base. Orca puts each release tag on its own release commits, so v1.4.219 does not contain v1.4.197; the script only needs the two to share history. The rebase replays Pod's commits (`<base>..HEAD`) and none of the base tag's release commits, so the result has the new tag's version of every file Pod does not touch.

```sh
node config/pod-sync-upstream.mjs v1.4.219                  # rebase onto branch sync/v1.4.219
node config/pod-sync-upstream.mjs v1.4.219 --branch try     # onto another new branch
node config/pod-sync-upstream.mjs --continue                # after resolving a stop by hand
node config/pod-sync-upstream.mjs v1.4.219 --report out.json   # also write the outcome as JSON
```

At each stop it resolves these files by rule and stages them. During a rebase git's `--ours` is the upstream side (the tag plus the Pod commits already replayed) and `--theirs` is the Pod commit being replayed.

- `package.json`: upstream's file, version included, with Pod's keys from the register re-applied: the `test:pod` and `typecheck:pod` scripts and the `vscode-jsonrpc`, `@xyflow/react` and `@dagrejs/dagre` dependencies. A new key goes after the one it follows in Pod's file.
- `pnpm-lock.yaml`: upstream's, then `pnpm install --lockfile-only` so pnpm adds Pod's dependencies back. It needs `pnpm` on the path and the network.
- `.gitattributes`: upstream's lines plus Pod's `/README.md merge=pod-keep` line and its `# Pod:` comment. The leading slash limits the driver to the top-level `README.md`; without it every `README.md` in the tree, `docs/pod/smoke/README.md` included, took the rebased commit's copy over the one it was rebased onto. The rule still accepts the old unanchored line, because the Pod commit that added it is replayed on every sync.
- `config/electron-builder.config.cjs`: upstream's file with Pod's identity lines re-applied (app id, product name, Windows executable name, mac DMG name, publish owner and repo), each read from `config/pod-brand.cjs`, and Pod's empty `protocols` list in place of the `orca://` scheme.
- A workflow under `.github/workflows-upstream/` that upstream has deleted: dropped, as Orca dropped it. This is the rename/delete stop on Pod's move-aside commit. It applies only when Pod's side is an unchanged move of upstream's `.github/workflows/` file and upstream has the file at neither path; a workflow Pod edited while moving it stops.

Each rule first checks that the Pod commit changed only what the rule knows how to re-apply, and that upstream still has the line or key it replaces. If not, it stops rather than guess: a Pod commit that changes another `package.json` key, a lockfile change without a Pod dependency change, upstream rewording `const appId = 'com.stablyai.orca'`, or a file one side added or deleted. The package.json keys and the electron-builder lines live in the script as `POD_PACKAGE_KEYS` and `ELECTRON_BUILDER_TOUCHES`. They mirror those rows of [`FORK_TOUCHPOINTS.md`](../../FORK_TOUCHPOINTS.md), so a new Pod dependency goes in both or every sync stops on it.

Any other conflicted file stops it with the rebase left in progress. It prints the Pod commit (with its position, "commit 12 of 62"), each file a person must resolve and why, and the files it already staged. Resolve those, `git add` them, and run `--continue`; it carries on applying the rules at later stops. `git rebase --abort` gives up, and `git branch -D sync/<tag>` then removes the branch.

After a clean rebase it moves every new upstream workflow from `.github/workflows/` to `.github/workflows-upstream/` (`src/shared/brand.test.ts` fails on a non-`pod-` file there) and bumps `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts`, all in one commit, `pod(sync): rebase onto Orca <tag>`. A clash in that step (a moved workflow already in `workflows-upstream/`) stops it the same way, and `--continue` finishes once fixed. It exits 0 when done, 2 when stopped for a person, and 1 when it refused or failed.

`node --test config/pod-sync-upstream.test.mjs` runs its tests, which build a small upstream and a Pod clone and need only Node and git. The lockfile rule needs pnpm and the network, so only real syncs cover it.

## The daily rehearsal

`.github/workflows/pod-upstream-drift.yml` runs at 06:00 UTC, or from the Actions tab on `main` with a tag. It finds the newest `vX.Y.Z` tag on stablyai/orca and runs three jobs.

1. `prepare` holds no secrets. It tests the script and runs it on `main`. On a clean rebase it runs `pnpm install --frozen-lockfile`, `pnpm tc` and the brand and updater tests, and if they pass it hands the new commits over as a git bundle.
2. `push` runs on a fresh runner and executes nothing from the repository. It checks that the bundle holds exactly `refs/heads/sync/<tag>` and that the commit sets the base tag to `<tag>`, then pushes that one ref to saiemamer/pod. It replaces an older `sync/<tag>` when `main` has moved since and leaves it alone when the tree is the same.
3. `report` files the outcome on one issue per tag, labelled `upstream-drift`: a new issue, or a comment on the open one. A stop lists the Pod commit, the files that need a person and why, and the files the rules resolved. A failed check, a failed push or a script error goes there too.

It never pushes `main` and never pushes or creates a tag. `GITHUB_TOKEN` is read-only for code in every job and can write issues only in `report`. The push uses the `POD_SYNC_TOKEN` secret, because GitHub refuses a `GITHUB_TOKEN` push that adds or changes files under `.github/workflows/`, and every sync branch does. Nobody has decided yet whether to add it; it would be a fine-grained token for saiemamer/pod only, with Contents and Workflows read and write. Until it exists the run stays green, nothing is pushed, and the tag's issue gets one note, once per tag, that the update is clean and checked, with the command that produces `sync/<tag>` locally.

## Rebase onto a new upstream release

If the rehearsal pushed `sync/<tag>`, check that branch out and skip to the list below. Otherwise run the script in a checkout with no other work in progress:

```sh
node config/pod-sync-upstream.mjs v1.4.219
```

It adds the `upstream` remote and the merge driver that keeps Pod's README if they are missing. Its fetch, by hand:

```sh
git remote add upstream https://github.com/stablyai/orca.git   # once
git config merge.pod-keep.driver 'cp %B %A'                    # once: keeps Pod's top-level README.md during rebases
OLD=v1.4.197 NEW=v1.4.219
git fetch --no-tags --filter=blob:none upstream "refs/tags/$OLD:refs/tags/$OLD" "refs/tags/$NEW:refs/tags/$NEW"
```

Fetch only the two tags, as above. Never push upstream tags to saiemamer/pod: `pod-release.yml` builds every `v*` tag, and Pod's own tags are `v0.x.y`. `git push origin main` (with or without `--force-with-lease`) pushes no tags; avoid `--tags` and `--follow-tags`.

At a stop the script hands over, find the file in `FORK_TOUCHPOINTS.md`, take upstream's version of the lines around the touch, and re-apply Pod's touch as the register describes it.

The shell wrapper snapshots in `src/main/__fixtures__/shell-wrapper-snapshots/` are generated, so never merge them by hand: take upstream's files, finish the wrapper source files, run `pnpm test:pod src/main/shell-wrapper-generated-file-snapshot.test.ts -u`, and check that `git diff` against upstream's files shows only Pod's PATH restore block (`src/main/pod/pod-cli-path-restore.ts`).

When the script has finished:

1. Check the tree: `pnpm install`, `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck:web`, `pnpm tc`, and `pnpm test:pod` in full. Regenerate the bundled skills (`pnpm run generate:bundled-skill-guides && pnpm run generate:skill-bundle-manifest`) and the RPC params catalog (`pnpm run generate:rpc-params-catalog`), and commit any change. Then run each upstream test excluded in `config/vitest.pod.config.ts` with `pnpm test <file>` and drop the exclusions that now pass for reasons other than Orca's identity strings.
2. Run the smokes in [`smoke/README.md`](./smoke/README.md) against `pnpm dev` on this tree, and the lineage performance gate, comparing with `main` on the same Mac.
3. Run the data check below.
4. Compare Orca's mac release job between the old and the new tag (`git diff <old-tag> <new-tag> -- .github/workflows/release-mac-build.yml`) against `pod-release.yml`. Carry over every install or build step the unsigned build cannot run without, and leave out signing, telemetry and Stably-only steps. Then push the branch and dispatch `pod-release.yml` on it with `mode=trial`, which builds and checks both apps and publishes nothing.
5. Land it. The rebase rewrites `main`'s history, so it goes up with `git push --force-with-lease origin main`, and every other clone resets to it (`git fetch origin && git reset --hard origin/main`, after moving local work onto a branch). Then cut a release with the new base named in its notes (see [`README.md`](./README.md), "Cut a release").

`FORK_TOUCHPOINTS.md` should end with the same rows it started with. A touch that had to grow belongs in the register in the same commit, and in the script's lists when it is one of the four rule files.

## What an update keeps

A user's Pod data sits in `~/Library/Application Support/Pod/profiles/local-default/` (the dev build uses `orca-dev`). Pod adds three optional top-level keys to Orca's saved state: `aeDomains`, `aeInitiatives` and `aeDomainSecrets` (each secret is encrypted with Electron's `safeStorage`, whose key is in the macOS Keychain item `Pod Safe Storage`; a development build uses `Orca Dev Safe Storage`). Electron names that item after the app name in force before `ready`, and packaged Pod sets it to `Pod` in `applyPodUserDataFolder` (`src/main/pod/pod-user-data.ts`), while `package.json` keeps Orca's `name`. A rebase changes neither the app id (`io.github.saiemamer.pod`), that name, nor the data folder, so an update opens the same profile and the same item.

Pods up to 0.1.12 kept their data in Orca's folder, `~/Library/Application Support/orca`, which stock Orca also uses. The first packaged start of a later Pod copies it once into `Pod` (`src/main/pod/pod-user-data.ts`, called from the packaged branch of `configure-process.ts`):

- It skips the copy when `Pod` already holds `pod-data-origin.json`, `profiles/` or `orca-profile-index.json`, and starts empty when `orca` holds neither `profiles/` nor `orca-data.json`.
- It refuses to start, with "Quit Orca or the older Pod before opening Pod", while the app named in `orca/orca-runtime.json` or `orca/SingletonLock` still runs, and stops the old Pod's terminal daemon (`orca/daemon/daemon-v*.pid`, only when that pid is a `Pod.app` process).
- It copies into `Pod.moving-<pid>` (cloned on APFS), leaving behind locks, sockets, `daemon/`, Chromium caches, `Crashpad/`, `logs/`, `pod-upgrade.command`, the Orca Mobile pairing files and the agent-hook endpoint files. It writes `pod-data-origin.json` last, then renames the folder to `Pod`. A launch that dies before the marker leaves only `Pod.moving-<pid>`, which the next start deletes and copies again.
- A `profile-state.db` with a newer schema than Pod's (saved by a stock Orca ahead of Pod's base) is not copied: the newest `orca-data.json.sqlite-export.<rev>.json` becomes `orca-data.json` (unless an older build edited `orca-data.json` after it, in which case that file stays), and the database, its other exports and backups stay behind, so Pod imports the JSON as on a first SQLite start.
- The source is never changed. Afterwards it is renamed to `orca.moved-to-pod-<date>` only when the Mac shows no sign of stock Orca (`/Applications/Orca.app`, `~/Applications/Orca.app`, `~/Library/Preferences/com.stablyai.orca.plist`); otherwise it stays for Orca. To roll back to an older Pod, rename that folder back to `orca`.

The CLI finds the same folder because Pod's launcher `resources/darwin/bin/orca` exports `ORCA_USER_DATA_PATH`. Packaged Pod keeps its Linear, Jira, Bitbucket, OpenAI speech and MiniMax files in `~/.pod` (`src/main/pod/pod-credential-copy.ts` copies the unencrypted ones from `~/.orca` once); only the main process loads those stores, and `pod-credential-store-processes.test.ts` keeps it that way. The rest of `~/.orca` stays shared with stock Orca.

Since Orca v1.4.219 (Pod's base from this sync on), the saved state lives in a SQLite database, `profile-state.db`, with one row per top-level key in its `profile_state_documents` table. Nothing filters the keys, so Pod's three keys get a row each like Orca's own. `orca-data.json` in the same folder is now a compatibility copy for older builds: Orca rewrites it from the database on a clean quit and during profile maintenance, and never reads it as a live store.

- The first start of a v1.4.219-based Pod finds `orca-data.json` and no database, and imports the file once. The import loads it through the same loader that keeps unknown keys (`normalize-loaded-profile-state.ts` spreads what it parses), and writes every key it gets, so Pod's keys move across. Orca also leaves a copy, `orca-data.json.sqlite-export.<rev>.json`, and keeps the latest five.
- Pod's own writes ask for a full save, which writes every key in memory and deletes rows for keys that are gone.
- Going back to a v1.4.197-based Pod after the move reads `orca-data.json` and ignores the database. After a clean quit that file holds the latest state. After a crash it can be older, and the older Pod shows that older state without warning.
- If the older Pod then saves, its `orca-data.json` no longer matches what the database last accepted, and the next start of a v1.4.219-based Pod refuses to pick silently. It shows a "Choose profile state" dialog. Its default, "Use SQLite (Recommended)", throws away the edits made in the older version. "Use JSON" keeps them and throws away what the newer version saved since. Orca archives both copies first and never merges them. `orca profile state rollback --current-json` makes the same choice from the command line.

`src/main/persistence/loading-store/ae-domain-persistence.round-trip.test.ts` covers Pod's writes through the database for `aeDomains` and `aeInitiatives`. The import from an existing `orca-data.json`, `aeDomainSecrets`, and the export back to `orca-data.json` are covered only by reading Orca's code, so the data check below is what proves them. Run it on every rebase, before landing:

1. On `main`'s build, run `POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-smoke.mjs` against `pnpm dev`. It creates the `pod-smoke` domain and an initiative in the dev data folder (`~/Library/Application Support/orca-dev`). Give the domain a test secret in Domain settings, and note a setting, for example the dbt command path.
2. Stop it, check out the rebased branch, `pnpm install`, and start `pnpm dev` again on the same data folder.
3. In DevTools (or over the debugging port), `await window.api.ae.domains.list()` and `await window.api.ae.initiatives.list()` must return the same domain and initiative, Domain settings must still list the secret, and the setting must be unchanged.
