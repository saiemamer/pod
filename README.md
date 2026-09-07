# Pod

Pod is an analytics-engineering IDE built as a thin fork of [Orca](https://github.com/stablyai/orca), the open-source desktop app for running many coding agents in parallel, one git worktree per agent.

Orca is excellent at parallel work inside one repository. Pod adds what analytics-engineering teams need on top:

- **Teams and initiatives.** A team folder holds several repos. One coordinator agent plans an initiative, dispatches workers into worktrees of the dbt repo, waits, then dispatches workers into the Omni repo, all inside one tracked run.
- **dbt, natively.** Jinja-aware SQL, a dbt language server, Cmd+Enter results from `dbt show`, compiled SQL, a column-level lineage canvas, project and profile discovery, and six dbt tools agents can call through `orca dbt ...`.
- **Omni.** The Omni CLI workflow (model branch, YAML, validate, commit) taught to agents as a skill, with the `omni` binary and credentials configured in Settings.

Pod tracks upstream Orca stable releases. Every Pod addition lives in `ae/` directories; every edit to an upstream file is listed in [`FORK_TOUCHPOINTS.md`](./FORK_TOUCHPOINTS.md).

## Status

Phase 0 of 4: bootstrap, rebrand, release pipeline. The full plan is in [`docs/pod/PLAN.md`](./docs/pod/PLAN.md). Current upstream base: see `upstreamBaseTag` in [`config/pod-brand.cjs`](./config/pod-brand.cjs).

## Install (macOS)

Download the DMG from the [latest release](https://github.com/saiemamer/pod/releases/latest) and drag Pod to Applications. Builds are not yet signed: on first launch, right-click the app and choose Open. Pod updates itself from the same releases page afterwards.

Pod and stock Orca both register a CLI named `orca` and share `~/.orca`. Install one or the other on a machine, not both.

## Develop

Requirements: Node 24, pnpm 12, Xcode Command Line Tools, Python 3. See [`docs/pod/README.md`](./docs/pod/README.md) for setup, the rebase procedure, and how to cut a release.

```sh
pnpm install
pnpm dev
```

## Licence

MIT, like Orca. Copyright for the upstream code remains with its authors; see [`LICENSE`](./LICENSE). Pod is not affiliated with Stably AI, dbt Labs, or Omni.
