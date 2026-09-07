# Pod UI smoke

`ui-smoke.mjs` drives a `pnpm dev` instance through Playwright over the Chrome DevTools port and exercises the Phase 1 UI: import a folder of two throwaway repos as a project group, open Domain settings, detect roles, save, start an initiative, and read the Initiative panel. It writes three screenshots.

```sh
mkdir -p ~/Projects/pod-smoke && cd ~/Projects/pod-smoke
mkdir dbt-demo && (cd dbt-demo && git init -q && printf 'name: demo\nprofile: demo\n' > dbt_project.yml && git add -A && git commit -qm init)
mkdir omni-demo && (cd omni-demo && git init -q && printf 'name: demo\n' > model.yaml && git add -A && git commit -qm init)

cd ~/Projects/pod
REMOTE_DEBUGGING_PORT=9333 ORCA_BACKGROUND_LAUNCH=1 pnpm dev   # separate terminal; uses ~/Library/Application Support/orca-dev
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-smoke.mjs
```

The dev instance keeps its own data directory, so the installed Pod is untouched. Re-runs skip the import when a `pod-smoke` group with repos already exists and delete empty duplicates from earlier runs.

For the orchestration half (run-create, task-create, two-step dispatch, `check --wait`), build the CLI once with `pnpm build:cli` and use `out/bin/orca` with `--from <coordinator terminal handle>`; the steps and what they taught are in `docs/pod/PLAN.md` under "Phase 1 outcome".

## dbt dock (Phase 2)

`ui-dbt-smoke.mjs` opens `models/marts/orders.sql` in the smoke dbt repo, presses Cmd+Enter (model run), selects three lines and presses Cmd+Enter again (inline run), then Cmd+Shift+Enter (compile), and reads the Connection tab. It needs a `dbt` on the path Pod is told about; without a warehouse on this Mac, `dbt-stub.sh` answers `show`, `compile` and `parse` with canned output.

```sh
S=~/Projects/pod-smoke
mkdir -p $S/bin $S/dbt-demo/models/marts && cp docs/pod/smoke/dbt-stub.sh $S/bin/dbt && chmod +x $S/bin/dbt
cd $S/dbt-demo && git init -q && printf 'name: demo\nprofile: demo\n' > dbt_project.yml
printf "{{ config(materialized='table') }}\n\nwith source as (\n    select * from {{ ref('stg_orders') }}\n),\n\nfinal as (\n    select\n        order_id,\n        status\n    from source\n    where status != 'cancelled'\n)\n\nselect * from final\n" > models/marts/orders.sql
printf "select 1 as order_id, 'paid' as status\n" > models/stg_orders.sql && git add -A && git commit -qm init

cd ~/Projects/pod
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-dbt-smoke.mjs   # against pnpm dev on port 9333
```

The script writes `toolCmdOverrides.dbt` into the dev instance's settings (its own data directory), imports the group if missing, and activates the `master` row under `dbt-demo`. Five screenshots: editor, model rows, inline rows, compiled SQL, connection.
