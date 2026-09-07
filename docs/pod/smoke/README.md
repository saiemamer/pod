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

`ui-dbt-smoke.mjs` opens `models/marts/orders.sql` in the smoke dbt repo, presses Cmd+Enter (model run), selects three lines and presses Cmd+Enter again (inline run), then Cmd+Shift+Enter (compile), and reads the Connection tab. It then waits for the language server, asks for completion inside `ref('…')`, Cmd-clicks the model name to open `stg_orders.sql`, and on a fresh model run sorts by `status`, searches `paid`, hides `amount`, exports the shown rows to `target/orders_results.csv`, and drags the dock handle up 120 px (then back). It needs a `dbt` on the path Pod is told about; without a warehouse on this Mac, `dbt-stub.sh` answers `show`, `compile`, `parse` and `docs generate` with canned output. The first run downloads dbt-language-server v0.4.2 (5 MB, from GitHub Releases) into the dev instance's data directory; the Connection tab shows where it landed.

```sh
S=~/Projects/pod-smoke
mkdir -p $S/bin $S/dbt-demo/models/marts && cp docs/pod/smoke/dbt-stub.sh $S/bin/dbt && chmod +x $S/bin/dbt
cd $S/dbt-demo && git init -q && printf 'name: demo\nprofile: demo\n' > dbt_project.yml
printf "{{ config(materialized='table') }}\n\nwith source as (\n    select * from {{ ref('stg_orders') }}\n),\n\nfinal as (\n    select\n        order_id,\n        status\n    from source\n    where status != 'cancelled'\n)\n\nselect * from final\n" > models/marts/orders.sql
printf "select 1 as order_id, 'paid' as status\n" > models/stg_orders.sql && git add -A && git commit -qm init

cd ~/Projects/pod
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-dbt-smoke.mjs   # against pnpm dev on port 9333
```

The script writes `toolCmdOverrides.dbt` into the dev instance's settings (its own data directory), imports the group if missing, and activates the `master` row under `dbt-demo`. Ten screenshots: editor, model rows, inline rows, compiled SQL, connection, completion popup, the opened `stg_orders.sql`, grid tools, export toast, resized dock. Re-runs are fine: the dock height persists, so the script restores it, and the previous rows stay visible while a rerun is in flight, so waits key on the status text.

Before pushing, `pnpm typecheck:pod` typechecks the changed files and everything they import in about half a minute; a cold `pnpm typecheck:web` needs more heap than this 8 GB Mac gives Node.

## Domain setup on a real machine

`domain-setup.mjs` turns a folder of clones into a domain without clicking: it imports the group, saves roles, stakeholder teams, agent env and dbt defaults through `window.api.ae.domains.save`, then opens Domain settings for a screenshot. It works against the installed Pod when that was started with a debugging port (`open -a Pod --args --remote-debugging-port=9334`).

```sh
POD_CDP=9334 POD_PARENT=$HOME POD_NAME=MEX \
POD_REPOS=$HOME/dbt-analytics,$HOME/omni-analytics \
POD_ROLES=$HOME/dbt-analytics=dbt,$HOME/omni-analytics=omni \
POD_TEAMS="Support Optimisation,Channels,Customer IAM,App Engagement,Dev-rel" \
POD_ENV="OMNI_BASE_URL=https://mollie.omniapp.co" \
POD_DBT_PROFILES_DIR=$HOME/dbt-analytics POD_SMOKE_OUT=/tmp \
node docs/pod/smoke/domain-setup.mjs
```

Secrets (`OMNI_API_KEY`) are added afterwards in the dialog, because the script never handles secret values.
