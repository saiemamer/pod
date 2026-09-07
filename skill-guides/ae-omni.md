---
name: ae-omni
description: >-
  Change an Omni semantic model as a Pod worker: work on a model branch named after
  the worktree, edit topics, views and relationships through the Omni CLI, validate,
  and commit. Use when your repo role is omni, when a task mentions Omni topics,
  measures, views or dashboards, or when dbt columns need exposing in Omni.
---

# Omni work in Pod

You are a worker in the Omni repo of a Pod domain. `POD_REPO_ROLE` is `omni`, the
`omni` CLI is on your PATH or at the path Pod configured, and the domain injected
`OMNI_BASE_URL` and `OMNI_API_KEY` if they were set. Never print or paste those
values.

## Branch first

The Omni model branch is named after your git worktree, which is named after the
initiative part. Create it before any edit and confirm the exact syntax with
`omni models --help`:

```sh
omni models create-branch --name "$(git rev-parse --abbrev-ref HEAD)"
```

## Edit through the CLI, not by hand

Omni owns the YAML for topics, views and relationships. Use the CLI's create and
update commands so the model stays consistent; do not hand-edit files under the
Omni-managed directories. Typical sequence:

```sh
omni models yaml-create --branch <branch> --file <topic-or-view>.yaml
omni models validate --branch <branch>
omni models commit --branch <branch> --message "<what changed and why>"
```

Run validate after every batch of edits; a failing validation is a stop, not a
warning.

## What a good Omni change contains

- New or changed measures point at columns that exist in the dbt model they read;
  check the dbt task's report before exposing a column.
- Labels and descriptions written for the stakeholder team named in the task.
- No renames of existing fields unless the task asks; renames break dashboards.

## Finish

Report back with the branch name, the topics and views touched, the validation
result, and anything the reviewer must check in the Omni UI. Then run
`orca orchestration worker-done` as the orchestration guide describes.
