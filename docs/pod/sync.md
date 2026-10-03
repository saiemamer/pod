# Keeping Pod in sync with Orca

Pod's `main` is an upstream Orca stable tag with Pod's commits replayed on top. To take a new Orca release, Pod rebases those commits onto the newer tag; it never merges upstream. The tag Pod sits on is `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts`, and Settings > General shows it after the version, as "(Orca v1.4.197)".

Three things keep a rebase small. Pod's own code lives in new files (`ae/` directories and the others listed in [`FORK_TOUCHPOINTS.md`](../../FORK_TOUCHPOINTS.md)), which never conflict. Every edit to an upstream file is one short touch with a row in that register, so a conflict is resolved by re-applying a known change. And `package.json` keeps upstream's name and version (the release workflow stamps Pod's version from the tag), so upstream's version bump does not conflict.

## Where it stands (2026-10-03)

Pod is still on v1.4.197. The daily rehearsal below has opened an issue for every newer stable tag from v1.4.198 to v1.4.219 (issues 2 to 19, [labelled `upstream-drift`](https://github.com/saiemamer/pod/issues?q=label%3Aupstream-drift), all open). The first stopped on `package.json` and `pnpm-lock.yaml`; the latest, v1.4.219, stops on `.gitattributes`, `config/electron-builder.config.cjs` and `package.json`. An issue lists only the files of the first Pod commit that stops, because the job aborts there, so the full set is larger.

## The daily rehearsal

`.github/workflows/pod-upstream-drift.yml` runs at 06:00 UTC. It finds the newest `vX.Y.Z` tag on stablyai/orca, rebases a throwaway copy of `main` onto it, and on a clean rebase runs `pnpm install --frozen-lockfile`, `pnpm tc` and the brand and updater tests. On a conflict or a failure it opens an issue labelled `upstream-drift`, or comments on the open one for the same tag. It never pushes. Run it by hand from the Actions tab with a tag, or with `main` to rehearse against upstream's branch before the next tag exists.

## Rebase onto a new upstream release

Do this on a branch, in a checkout with no other work in progress. During a rebase git's `--ours` is the upstream side being rebased onto and `--theirs` is the Pod commit being replayed.

```sh
git remote add upstream https://github.com/stablyai/orca.git   # once
git config merge.pod-keep.driver 'cp %B %A'                    # once: keeps Pod's README.md during rebases
OLD=v1.4.197 NEW=v1.4.219
git fetch --no-tags --filter=blob:none upstream "refs/tags/$OLD:refs/tags/$OLD" "refs/tags/$NEW:refs/tags/$NEW"
git checkout -b "sync/$NEW" main
git rebase --onto "$NEW" "$OLD"
```

Fetch only the two tags, as above. Never push upstream tags to saiemamer/pod: `pod-release.yml` builds every `v*` tag, and Pod's own tags are `v0.x.y`. `git push origin main` (with or without `--force-with-lease`) pushes no tags; avoid `--tags` and `--follow-tags`.

At each stop, find the file in `FORK_TOUCHPOINTS.md`, take upstream's version of the lines around the touch, and re-apply Pod's touch as the register describes it. The files that stop rebases today:

- `package.json`: keep upstream's version of everything except what the register lists: the `test:pod` and `typecheck:pod` scripts and the dependencies Pod added (`vscode-jsonrpc`, `@xyflow/react`, `@dagrejs/dagre`).
- `pnpm-lock.yaml`: do not merge it by hand. Take upstream's (`git checkout --ours pnpm-lock.yaml`), then run `pnpm install` so pnpm adds Pod's dependencies back, and `git add` the result.
- `.gitattributes`: keep upstream's lines and Pod's `README.md merge=pod-keep` line.
- `config/electron-builder.config.cjs`: upstream's file with Pod's identity values re-applied (appId, product name, mac executable and artifact names, publish owner and repo), all read from `config/pod-brand.cjs`.

Then `git add` the file and `git rebase --continue`. If upstream added a workflow under `.github/workflows/`, move it aside, or `src/shared/brand.test.ts` fails: `git mv .github/workflows/<new>.yml .github/workflows-upstream/`.

When the rebase finishes:

1. Bump `upstreamBaseTag` in `config/pod-brand.cjs` and `POD_UPSTREAM_BASE_TAG` in `src/shared/brand.ts` in one commit.
2. Check the tree: `pnpm install`, `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck:web`, `pnpm tc`, and `pnpm test:pod` in full. Then run each upstream test excluded in `config/vitest.pod.config.ts` with `pnpm test <file>` and drop the exclusions that now pass for reasons other than Orca's identity strings.
3. Run the smokes in [`smoke/README.md`](./smoke/README.md) against `pnpm dev` on this tree, and the lineage performance gate, comparing with `main` on the same Mac.
4. Run the data check below.
5. Land it. The rebase rewrites `main`'s history, so it goes up with `git push --force-with-lease origin main`, and every other clone resets to it (`git fetch origin && git reset --hard origin/main`, after moving local work onto a branch). Then cut a release with the new base named in its notes (see [`README.md`](./README.md), "Cut a release").

`FORK_TOUCHPOINTS.md` should end with the same rows it started with. A touch that had to grow belongs in the register in the same commit.

## What an update keeps

A user's Pod data sits in `~/Library/Application Support/orca/orca-data.json`, the file Orca uses for its own settings and workspaces. Pod adds three optional top-level keys to it: `aeDomains`, `aeInitiatives` and `aeDomainSecrets` (each secret is encrypted with Electron's `safeStorage`, whose key is in the macOS Keychain). Upstream's loader keeps keys it does not know, and Pod's readers normalize what they find, so a file written by an older or newer Pod still loads. A rebase changes neither the app id (`io.github.saiemamer.pod`) nor the data folder, so an update over an upstream bump opens the same file.

What could still break that: upstream moving its persisted state out of `orca-data.json`, or a migration that rewrites the file and drops unknown keys. Nobody has checked the releases after v1.4.197 for either, and no rebase has yet carried a user's data across an upstream bump. Check it on every rebase, before landing:

1. On `main`'s build, run `POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-smoke.mjs` against `pnpm dev`. It creates the `pod-smoke` domain and an initiative in the dev data folder (`~/Library/Application Support/orca-dev`). Give the domain a test secret in Domain settings, and note a setting, for example the dbt command path.
2. Stop it, check out the rebased branch, `pnpm install`, and start `pnpm dev` again on the same data folder.
3. In DevTools (or over the debugging port), `await window.api.ae.domains.list()` and `await window.api.ae.initiatives.list()` must return the same domain and initiative, Domain settings must still list the secret, and the setting must be unchanged.
