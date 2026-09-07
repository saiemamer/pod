---
name: ae-dbt
description: >-
  Change dbt models as a Pod worker: find the project, run dbt through the path Pod
  configured with the domain's profile and target, build only what you changed, test
  it, and report the columns downstream Omni work depends on. Use when your repo role
  is dbt or a task names models, sources, seeds or snapshots.
---

# dbt work in Pod

You are a worker in the dbt repo of a Pod domain. `POD_REPO_ROLE` is `dbt`. If the
domain set them, `DBT_PROFILES_DIR` and `DBT_TARGET` are in your environment; pass
`--target "$DBT_TARGET"` when it is set. Never print credentials, and never run
against a production target unless the task says so in as many words.

## Find the project

The project is the nearest `dbt_project.yml` above the models you change; in some
repos it sits one level down (for example `dbt/`). Run every dbt command from that
directory.

## Work in small, buildable steps

```sh
dbt parse
dbt build --select <model>+ --target "$DBT_TARGET"
dbt test --select <model>
```

Prefer `--select` over unscoped runs: BigQuery bills per query, and an unscoped
build on a large project takes an hour. Use `dbt show --select <model> --limit 50`
to look at rows while you work.

## What a good dbt change contains

- Model SQL that follows the repo's conventions (CTE names, one grain per model,
  documented columns in the model's YAML).
- Tests for new keys and accepted values.
- A note in your report listing the columns that changed, were added or removed,
  because the Omni worker after you exposes them.

## Finish

Commit on the worktree branch, open the merge request the repo's conventions ask
for, and report: models touched, columns changed, tests run, anything unresolved.
Then run `orca orchestration worker-done` as the orchestration guide describes.
