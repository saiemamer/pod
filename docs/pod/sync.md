# Keeping Pod in sync with Orca

Pod's `main` is an upstream Orca stable tag with Pod's commits replayed on top. To take a new Orca release, Pod rebases those commits onto the newer tag; it never merges upstream. The tag Pod sits on is `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts`, and Settings > General shows it after the version, as "(Orca v1.4.197)".

Three things keep a rebase small. Pod's own code lives in new files (`ae/` directories and the others listed in [`FORK_TOUCHPOINTS.md`](../../FORK_TOUCHPOINTS.md)), which never conflict. Every edit to an upstream file is one short touch with a row in that register, so a conflict is resolved by re-applying a known change. And `package.json` keeps upstream's name and version (the release workflow stamps Pod's version from the tag), so upstream's version bump does not conflict.

## Where it stands (2026-10-03)

Pod is still on v1.4.197. The daily rehearsal below has opened an issue for every newer stable tag from v1.4.198 to v1.4.219 (issues 2 to 19, [labelled `upstream-drift`](https://github.com/saiemamer/pod/issues?q=label%3Aupstream-drift), all open). Sixteen of them stopped only on some of `package.json`, `pnpm-lock.yaml`, `.gitattributes` and `config/electron-builder.config.cjs`, the four files the sync script below resolves by rule; v1.4.199 and v1.4.200 (issues 3 and 4) stopped on `src/renderer/src/store/index.ts`. Those issues list only the files of the first Pod commit that stopped, because the old job aborted there.

The new rehearsal's second manual run onto v1.4.219 (run 37159854951) resolved the three clashes in commit 1 of 69 by rule, replayed commit 2, and stopped at commit 3, Pod's move-aside commit, on `track-community-prs.yaml`, a workflow Orca has deleted. The script now drops such a workflow by rule; later stops are not known yet.

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
- `.gitattributes`: upstream's lines plus Pod's `README.md merge=pod-keep` line and its `# Pod:` comment.
- `config/electron-builder.config.cjs`: upstream's file with Pod's identity lines re-applied (app id, product name, Windows executable name, mac DMG name, publish owner and repo), each read from `config/pod-brand.cjs`.
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
git config merge.pod-keep.driver 'cp %B %A'                    # once: keeps Pod's README.md during rebases
OLD=v1.4.197 NEW=v1.4.219
git fetch --no-tags --filter=blob:none upstream "refs/tags/$OLD:refs/tags/$OLD" "refs/tags/$NEW:refs/tags/$NEW"
```

Fetch only the two tags, as above. Never push upstream tags to saiemamer/pod: `pod-release.yml` builds every `v*` tag, and Pod's own tags are `v0.x.y`. `git push origin main` (with or without `--force-with-lease`) pushes no tags; avoid `--tags` and `--follow-tags`.

At a stop the script hands over, find the file in `FORK_TOUCHPOINTS.md`, take upstream's version of the lines around the touch, and re-apply Pod's touch as the register describes it.

When the script has finished:

1. Check the tree: `pnpm install`, `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck:web`, `pnpm tc`, and `pnpm test:pod` in full. Regenerate the bundled skills (`pnpm run generate:bundled-skill-guides && pnpm run generate:skill-bundle-manifest`) and commit any change. Then run each upstream test excluded in `config/vitest.pod.config.ts` with `pnpm test <file>` and drop the exclusions that now pass for reasons other than Orca's identity strings.
2. Run the smokes in [`smoke/README.md`](./smoke/README.md) against `pnpm dev` on this tree, and the lineage performance gate, comparing with `main` on the same Mac.
3. Run the data check below.
4. Land it. The rebase rewrites `main`'s history, so it goes up with `git push --force-with-lease origin main`, and every other clone resets to it (`git fetch origin && git reset --hard origin/main`, after moving local work onto a branch). Then cut a release with the new base named in its notes (see [`README.md`](./README.md), "Cut a release").

`FORK_TOUCHPOINTS.md` should end with the same rows it started with. A touch that had to grow belongs in the register in the same commit, and in the script's lists when it is one of the four rule files.

## What an update keeps

A user's Pod data sits in `~/Library/Application Support/orca/orca-data.json`, the file Orca uses for its own settings and workspaces. Pod adds three optional top-level keys to it: `aeDomains`, `aeInitiatives` and `aeDomainSecrets` (each secret is encrypted with Electron's `safeStorage`, whose key is in the macOS Keychain). Upstream's loader keeps keys it does not know, and Pod's readers normalize what they find, so a file written by an older or newer Pod still loads. A rebase changes neither the app id (`io.github.saiemamer.pod`) nor the data folder, so an update over an upstream bump opens the same file.

What could still break that: upstream moving its persisted state out of `orca-data.json`, or a migration that rewrites the file and drops unknown keys. Nobody has checked the releases after v1.4.197 for either, and no rebase has yet carried a user's data across an upstream bump. Check it on every rebase, before landing:

1. On `main`'s build, run `POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-smoke.mjs` against `pnpm dev`. It creates the `pod-smoke` domain and an initiative in the dev data folder (`~/Library/Application Support/orca-dev`). Give the domain a test secret in Domain settings, and note a setting, for example the dbt command path.
2. Stop it, check out the rebased branch, `pnpm install`, and start `pnpm dev` again on the same data folder.
3. In DevTools (or over the debugging port), `await window.api.ae.domains.list()` and `await window.api.ae.initiatives.list()` must return the same domain and initiative, Domain settings must still list the secret, and the setting must be unchanged.
