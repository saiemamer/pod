---
name: ae-initiative
description: >-
  Run a Pod initiative as the main agent of a domain: read the domain's repos and
  roles, write the plan into INITIATIVE.md, create an orchestration run, dispatch
  dbt workers first and Omni workers after, wait on worker_done and escalation,
  review, and report. Use when you are the main agent in a domain or initiative
  folder, or when a request spans the dbt and Omni repos of one domain.
---

# Pod initiatives

You are the main agent of a Pod domain. A domain is a folder of repos with a role
each (dbt, omni, other). An initiative is one piece of cross-repo work with its own
folder under `initiatives/` and one orchestration run. You plan, dispatch workers,
wait, review and report. You do not edit models or Omni YAML yourself; workers do.

## Resolve the CLI for this session

Use the `orca` executable that Pod exported for this terminal: `$ORCA_CLI_COMMAND`
if set, else `orca` on PATH. Every command below is run through it.

## Orient

1. `orca domain show --domain "$POD_DOMAIN_ID" --json` lists the repos with ids and
   roles, the env variable names the domain injects, the dbt defaults, and the
   initiatives so far. `POD_DOMAIN_ID`, `POD_DOMAIN_NAME` and `POD_REPO_ROLE` are in
   your environment whenever you run inside a domain.
2. Read `INITIATIVE.md` in the current folder. If it has no goal, ask the person for
   one before planning. If you are in the domain folder rather than an initiative
   folder, create `initiatives/<slug>/INITIATIVE.md` first.

## Plan

Write the plan into `INITIATIVE.md` as parts. Each part names the repo it touches, the
role of that repo, what changes, and what it depends on. Rules that hold for every
initiative:

- dbt parts come before Omni parts that read their columns.
- A part fits one worker session: one model family, one topic, one migration step.
- Stop and show the plan to the person before dispatching anything.

## Run

```sh
orca orchestration run-create --objective "<goal in one sentence>" --json
orca orchestration task-create --run <run_id> --task-title "<part>" --spec "<what to change, in which repo, done when...>" --json
orca orchestration task-create --run <run_id> --task-title "<omni part>" --spec "..." --deps '["<dbt task id>"]' --json
```

Put the repo id and role in each task spec so the worker knows where it is.

## Dispatch

For each ready task, start a worker in a fresh worktree of the right repo:

```sh
orca orchestration worker-start --task <task_id> --worktree new-top-level --repo id:<repo_id> --name <initiative-slug>-<part> --agent claude --json
```

If Pod refuses to create the worktree from a folder terminal (`selector_not_found`),
create it explicitly and hand the existing worktree to the worker:

```sh
orca worktree create --repo id:<repo_id> --parent-worktree "$ORCA_WORKSPACE_KEY" --agent claude --name <initiative-slug>-<part> --json
orca orchestration worker-start --task <task_id> --worktree id:<worktree_id> --agent claude --json
```

The worktree name is also the git branch name and, for an Omni repo, the Omni model
branch name. Keep it short and unique: `<initiative-slug>-<part>`.

Tell each worker which skill to load in the task spec: dbt workers use `ae-dbt`,
Omni workers use `ae-omni` (both via `orca skills get <name>`).

## Wait and review

```sh
orca orchestration check --wait --types worker_done,escalation --run <run_id> --json
```

On `worker_done`, read the worker's report and diff, then mark the next tasks ready
or ask the person to review. On `escalation`, answer the worker with
`orca orchestration reply` or bring the question to the person. Never dispatch the
Omni phase until every dbt task it depends on is done and reviewed.

## Report

Update `INITIATIVE.md` with what shipped, the merge requests, and what is left.
Set the status line to `review` when everything is dispatched and to `done` when
merged. Keep notes in the initiative folder, not in the repos.
