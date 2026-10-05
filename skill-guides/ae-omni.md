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
`OMNI_BASE_URL`, `OMNI_API_KEY` and `OMNI_MODEL_ID` if they were set. Never print or
paste the key. Without a key the CLI signs in with its own profile, from `omni config init`
or `omni config login` in `~/.config/omni-cli/config.json`. If a command reports that the
CLI is not signed in, stop and report it; both sign-in commands are interactive and belong
to the person.

`orca omni` wraps the three steps Pod tracks, so the branch is always the one named
after your worktree. Each reads the model from `OMNI_MODEL_ID` (or `--model <id>`) and
passes the key to the Omni CLI as `OMNI_API_TOKEN`, the name the CLI reads.

## Branch first

The Omni model branch is named after your git branch, which is named after the
initiative part. Create it before any edit:

```sh
orca omni branch --create --json
```

The JSON carries `branch.id`, the branch UUID the Omni CLI's branch flags take.

## Edit through the CLI, not by hand

Omni owns the YAML for topics, views and relationships. Write it through the CLI on
your branch so the model stays consistent; do not hand-edit files under the
Omni-managed directories. Path parameters are positional and request bodies go in
`--body`. Spell every flag exactly as `omni models <command> --help` prints it: most are
one lowercase word (`--branchid`, `--filename`, `--pagesize`), but `get-topic` and
`list-topics` take `--branch-id`. An unknown flag fails the whole command.

```sh
omni models yaml-get "$OMNI_MODEL_ID" --branchid <branch id> --filename tickets.view
omni models yaml-create "$OMNI_MODEL_ID" --body '{"branchId": "<branch id>", "fileName": "tickets.view", "yaml": "<the whole file>"}'
omni models get-topic "$OMNI_MODEL_ID" tickets --branch-id <branch id>
```

## Validate, then commit

```sh
orca omni validate --json
orca omni commit --message "<what changed and why>" --json
```

`validate` exits 0 either way: read `valid` and `errors`. An error is a stop, not a
warning. `commit` pushes the branch to git and returns `prUrl`, the pull request the
reviewer opens.

## What a good Omni change contains

- New or changed measures point at columns that exist in the dbt model they read;
  check the dbt task's report before exposing a column.
- Labels and descriptions written for the stakeholder team named in the task.
- No renames of existing fields unless the task asks; renames break dashboards.

## Finish

Report back with the branch name, the topics and views touched, the validation
result, the pull request URL, and anything the reviewer must check in the Omni UI.
Then send `worker_done` once with the `orca orchestration send --type worker_done` command
your dispatch preamble gives, IDs filled in; the orchestration guide has the rules.
