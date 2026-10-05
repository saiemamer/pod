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

## Group without a folder

`ui-group-initiative-smoke.mjs` makes a group the way the project menu's "New group from project" does (a name only, no folder), moves `dbt-demo` into it, and opens Domain settings without pressing Detect: the role must read `dbt`. It then puts a file named `initiatives` in `~/Pod/pod-smoke-no-folder/`, opens New initiative, checks the dialog names the folder `~/Pod/pod-smoke-no-folder/initiatives/pod-smoke-test`, presses Start, and expects a plain error with no "Error invoking remote method" text and no initiative record. With the file gone, a second press must make exactly one initiative with its `INITIATIVE.md`. Claude opens with the prompt drafted, not sent. It removes the initiative's workspace, the domain, the group and `~/Pod/pod-smoke-no-folder` afterwards and moves `dbt-demo` back. On the code before the fix the role reads `other` and the start fails on `mkdir '/initiatives/pod-smoke-test'`. Three screenshots: `group-initiative-1-roles` to `group-initiative-3-started`.

```sh
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-group-initiative-smoke.mjs   # against pnpm dev on port 9333, after ui-smoke.mjs
```

For the orchestration half (run-create, task-create, two-step dispatch, `check --wait`), build the CLI once with `pnpm build:cli` and use `out/bin/orca` with `--from <coordinator terminal handle>`; the steps and what they taught are in `docs/pod/PLAN.md` under "Phase 1 outcome".

## Test rules

Pod's own tests follow these rules (2026-10-03):

- Before adding a unit test, name the behaviour it protects and a realistic bug that would make it fail. If an existing test or smoke step already catches that bug, do not add it.
- Test through the module's public interface. No test may need an export, flag or hook that production code does not use.
- Mock only at a real boundary: an external binary such as `omni` or `dbt` (the stand-ins in this folder), the network, IPC, persistence, the clock. Do not mock Pod's own modules.
- No test that restates a constant, a type or the implementation line by line, and no test that checks a mock returns what it was told.
- A test written for a bug fix must fail on the code before the fix.
- User-visible behaviour is proven by a smoke step here that fails without the change, not by a component unit test.

## dbt dock (Phase 2)

`ui-dbt-smoke.mjs` opens `models/marts/orders.sql` in the smoke dbt repo, presses Cmd+Enter (model run), selects three lines and presses Cmd+Enter again (inline run), then Cmd+Shift+Enter (compile), and reads the Connection tab. It then waits for the language server, asks for completion inside `ref('…')`, Cmd-clicks the model name to open `stg_orders.sql`, and on a fresh model run sorts by `status`, searches `paid`, hides `amount`, exports the shown rows to `target/orders_results.csv`, and drags the dock handle up 120 px (then back). It needs a `dbt` on the path Pod is told about; without a warehouse on this Mac, `dbt-stub.sh` answers `show`, `compile`, `parse` and `docs generate` with canned output. The first run downloads dbt-language-server v0.4.2 (5 MB, from GitHub Releases) into the dev instance's data directory; the Connection tab shows where it landed.

```sh
S=~/Projects/pod-smoke
mkdir -p $S/bin $S/dbt-demo/models/marts && cp docs/pod/smoke/dbt-stub.sh $S/bin/dbt && chmod +x $S/bin/dbt
cd $S/dbt-demo && git init -q && printf 'name: demo\nprofile: demo\n' > dbt_project.yml
printf "{{ config(materialized='table') }}\n\nwith source as (\n    select * from {{ ref('stg_orders') }}\n),\n\nfinal as (\n    select\n        order_id,\n        status,\n        amount\n    from source\n    where status != 'cancelled'\n)\n\nselect * from final\n" > models/marts/orders.sql
printf "select 1 as order_id, 'paid' as status\n" > models/stg_orders.sql && git add -A && git commit -qm init

cd ~/Projects/pod
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-dbt-smoke.mjs   # against pnpm dev on port 9333
```

The script writes `toolCmdOverrides.dbt` into the dev instance's settings (its own data directory), imports the group if missing, and activates the `master` row under `dbt-demo`. Ten screenshots: editor, model rows, inline rows, compiled SQL, connection, completion popup, the opened `stg_orders.sql`, grid tools, export toast, resized dock. Re-runs are fine: the dock height persists, so the script restores it, and the previous rows stay visible while a rerun is in flight, so waits key on the status text.

Before pushing, run the full check with a bigger heap: `NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck:web` (about four minutes cold, twenty seconds once `config/tsconfig.tc.web.tsbuildinfo` exists). Node's default 2 GB heap dies on this 8 GB Mac even with the cache warm. `pnpm typecheck:pod` checks only the changed files and their imports in about half a minute, for quick loops.

## Fresh copy of a dbt repo

`ui-fresh-copy-smoke.mjs` commits a `packages.yml` to the smoke dbt repo, marks the package installed in the main copy (`dbt_packages/dbt_utils`), creates a new workspace through `window.api.worktrees.create`, and waits for Pod to prepare it unasked: packages copied from the main copy, then `dbt parse`. It then opens `orders.sql` in the new workspace, presses Cmd+Alt+L, and fails unless the canvas draws with no `DbtGraphNotReadyError` or `DbtRunError` text in the dock. The stand-in `dbt` refuses `parse` while a listed package is missing, as dbt Core does, so the step fails on a build without the preparation. Run `ui-lineage-smoke.mjs` once first; it writes the models.

```sh
cp docs/pod/smoke/dbt-stub.sh ~/Projects/pod-smoke/bin/dbt
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-fresh-copy-smoke.mjs   # against pnpm dev on 9333
```

## Lineage canvas and Database explorer (Phase 3)

`ui-lineage-smoke.mjs` adds a source and a downstream model to the smoke repo (`models/sources.yml`, `models/marts/order_summary.sql`, and a `stg_orders.sql` that reads the source), opens `orders.sql`, presses Cmd+Alt+L for the Lineage tab, clicks the `status` column and reads which columns lit up, opens the upstream/downstream list, collapses and restores one side, then switches the right sidebar to the Database tab, expands `orders`, filters on `status`, uses "Show lineage" on `order_summary` and `stg_orders`, then opens `status_report` at upstream depth 1 and loads `stg_orders` through `orders_by_customer`, checking that the edge to `order_statuses` appears and its "+1" clears (a shared parent). Side-button clicks are not forced; each asserts the node count, and the clicked node may move at most 4 px in any frame, including when the button brings a selected node back. Last, `lineage-wide-smoke-step.mjs` opens `events_base` (500 columns) and checks the first ready frame: the focus, its source and its two wide children lie inside the canvas at no less than 60 %, each header names its layer, the focus lists six columns and "+494 more columns", the expanded list filters, and a lit `col_300` stays among the six rows after collapsing. On the code before 2026-10-04 the canvas opened at 100 % and the two 500-column children overflowed it. The stand-in `dbt` writes a manifest of the orders models (source, `stg_orders`, `orders`, `order_summary`, `orders_by_customer`, `order_statuses`, `status_report`) plus the wide events chain, and a catalog with columns, so copy it again if yours predates 2026-10-04.

```sh
cp docs/pod/smoke/dbt-stub.sh ~/Projects/pod-smoke/bin/dbt
python3 -m venv /tmp/sqlglot-venv && /tmp/sqlglot-venv/bin/pip install sqlglot   # optional
POD_SMOKE_OUT=/tmp POD_SMOKE_PYTHON=/tmp/sqlglot-venv/bin/python node docs/pod/smoke/ui-lineage-smoke.mjs
```

`POD_SMOKE_PYTHON` is written into the dev instance's `toolCmdOverrides.python`; leave it out and column lineage falls back to name matching, which the toolbar's engine label shows. The same venv runs the gated unit test: `POD_SQLGLOT_PYTHON=/tmp/sqlglot-venv/bin/python pnpm test:pod src/main/ae/dbt/dbt-column-lineage.test.ts`.

Since 2026-10-05 Pod ships sqlglot (`resources/pod-sqlglot`), so the venv is no longer needed. With `POD_SMOKE_PYTHON` left out, Pod picks a Python itself (the stand-in `dbt` is a shell script, so `python3` on PATH) and step 4b fails unless the toolbar's engine label reads `sqlglot`; it logs the tooltip, which names the sqlglot version and the Python. The gated unit test takes any Python 3.9 or later, with or without sqlglot of its own: `POD_SQLGLOT_PYTHON=/usr/bin/python3 pnpm test:pod src/main/ae/dbt/dbt-column-lineage.test.ts`.

## Catalog under a personal target

`ui-catalog-smoke.mjs` sets `POD_STUB_DOCS` in the dbt env so the stand-in `dbt` plays a personal target. With `broken`, `docs generate` prints Python warnings and a compile error and writes no catalog; with `unbuilt`, it stops in that compile unless `--no-compile` is passed, and otherwise writes a catalog without `orders`, lists two refused datasets under `errors` and exits 1, as dbt Core does. The script removes `target/catalog.json`, opens the Database tab on `dbt-demo`, and checks: the empty state says the button reads from the warehouse and can take a minute or two; a run shows its elapsed time; the failure names `order_summary` and the missing table with no warning line, and Details holds dbt's text; the failure is still there after switching to Explorer and back; with `unbuilt` the run is a result that counts and lists the two datasets, `orders` is still listed and marked not built, and `stg_orders` is not. It restores the dbt env and regenerates the full catalog afterwards. Three screenshots: `catalog-1-empty` (first run in a session only), `catalog-2-failed`, `catalog-3-partial`.

```sh
cp docs/pod/smoke/dbt-stub.sh ~/Projects/pod-smoke/bin/dbt
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-catalog-smoke.mjs   # against pnpm dev on port 9333, after ui-lineage-smoke.mjs
```

## Editor and panel fixes (2026-10-04)

`ui-panels-smoke.mjs` checks four fixes from the 0.1.13 test on the smoke dbt repo. In the file explorer, a right-click on `models/marts/orders.sql` must offer "Show lineage" and open the dock's Lineage tab, and a right-click on `dbt_project.yml` must not offer it. A hover on `ref('stg_orders')` must render in the body-level overflow host, lie inside the window, and have no corner covered by another element. With the Database tab open, six drags of the right panel's edge must leave the tab open (the persistence echo used to switch it to Explorer). A drag of the dock handle must keep the dock's height within 2 px of the pointer at every step. It prints PASS or FAIL per check and exits 1 on a FAIL. One screenshot of the hover and one of the Database tab after the resizes.

```sh
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-panels-smoke.mjs   # against pnpm dev on port 9333
```

## Performance gate (before a merge or a release)

`perf-fixture.mjs` writes a 1,000-node dbt project into the smoke repo (`perf/manifest.json`, `perf/catalog.json`, 940 model files under `models/perf/`), woven around the real `orders` models. The stand-in `dbt` serves it when `POD_STUB_MANIFEST` and `POD_STUB_CATALOG` are set, which `ui-lineage-perf.mjs` does through the dbt settings env. `graph-bench.mjs` times the graph code in Node; `ui-lineage-perf.mjs` drives the real app over DevTools and prints PASS/FAIL per check (graph IPC ≤ 300 ms, first Lineage open ≤ 1.5 s, zoom and pan frames avg ≤ 20 ms and p95 ≤ 33 ms, cold column lineage ≤ 8 s and warm ≤ 500 ms, column click to lit path ≤ 600 ms, no task over 150 ms across 20 tab round trips, post-GC heap growth ≤ 15 MB, Database panel open ≤ 800 ms and filter ≤ 250 ms with a thousand relations). It restores the settings and the small default manifest afterwards.

```sh
node docs/pod/smoke/perf-fixture.mjs
POD_SQLGLOT_PYTHON=/tmp/sqlglot-venv/bin/python npx tsx docs/pod/smoke/graph-bench.mjs
POD_SMOKE_OUT=/tmp POD_SMOKE_PYTHON=/tmp/sqlglot-venv/bin/python node docs/pod/smoke/ui-lineage-perf.mjs   # against pnpm dev on 9333
```

On this 8 GB Intel Mac the pan-average and Database panel filter checks miss when other apps are busy, on `main` as well as on a branch, and pass when the Mac is quiet (2026-10-03: pan average 19.9 to 23.2 ms against the 20 ms limit while busy, 16.8 ms quiet). Close other apps before a gate run, and compare against `main` on the same machine before blaming a change.

The report lands in `POD_SMOKE_OUT/pod-perf-report.json`. Delete `models/perf/` and `perf/` from the smoke repo afterwards if the default smoke repo should stay small.

When a check fails, run it again with `POD_PERF_PROFILE=1`: the script then records a V8 CPU profile per timed step (`perf-profile-first-open.cpuprofile`, `column-click`, `depth-change`, `tab-cycles`, `panel-open`, `panel-filter`) next to the report. Open one in Chrome DevTools > Performance, or sum the self time per function from the JSON. The sampling costs a few percent, so the gate itself runs without it. Remember the dev build renders under React StrictMode, which runs every render twice, and that `(program)` in a profile is Blink's own style and layout work.

## Omni panel (Phase 4)

`ui-omni-smoke.mjs` points `toolCmdOverrides.omni` at `omni-stub.sh` in this repo (a stand-in for the Omni CLI 1.0.4 that answers `omni models list | create-branch | validate | commit | list-topics | get-topic` with JSON shaped like Omni's spec, rejects a flag the real subcommand lacks with the real CLI's `Error: unknown flag` and usage, and never touches the network) and gives the `pod-smoke` domain a fake `OMNI_API_KEY` and a fresh stub state directory. On `omni-demo`'s `master` worktree it opens the right sidebar's Omni tab, checks that the picker lists the shared models from both pages of the model list, chooses one (saved as `OMNI_MODEL_ID` in the domain env), checks that the `master` branch is not on Omni yet and that the shared model shows three topics, creates the branch, checks that the topics re-read on the branch (four, one branch-only), validates (one error, one warning), and opens the Tickets topic. With `out/bin/orca` built it also runs `orca omni branch`, `validate` and `commit --json` from the repo. It then clears `OMNI_MODEL_ID` with the panel open and expects the picker back, this time with the stub in `POD_OMNI_STUB_MODELS=endless-schema` mode, so the picker shows its no-shared-models line and the 1,000-model cap. Last, it checks that every stub call carried a token, which proves the domain's `OMNI_API_KEY` reached the CLI as `OMNI_API_TOKEN`. It restores the settings and the domain env afterwards. Six screenshots: `omni-1-picker` to `omni-6-no-shared-models`.

```sh
pnpm build:cli   # optional, for the CLI steps
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-omni-smoke.mjs   # against pnpm dev on port 9333
```

## dbt MCP server (Phase 4)

`ui-mcp-smoke.mjs` sets Settings > Analytics Tools > "pod-dbt-mcp command" to the package's `src/server.js`, gives Claude a user flag of its own, and clicks the "dbt tools for Claude Code (MCP)" switch. On, it expects `<userData>/pod-mcp.json` naming the server and Claude's default arguments to read `<user flag> --mcp-config '<that file>'`. It then starts the server that file names, over MCP, in `dbt-demo`, and calls `dbt_list_models`, which goes through `out/bin/orca` to this Pod and the stand-in `dbt`. Off, only Pod's pair goes. With no Claude setting of the user's own, on adds the pair to the built-in default and off removes the `claude` key again, so the user keeps following the default. Last, with the server path pointing nowhere, the switch stays off and shows the reason. Settings written from the smoke's own window do not reach the open Settings page (`settings:changed` skips the window that made the change), so the script reopens Settings after each such write. It restores the settings and deletes the config file afterwards. Three screenshots: `mcp-1-off`, `mcp-2-on`, `mcp-3-missing-server`.

```sh
pnpm build:cli && pnpm --dir packages/pod-dbt-mcp install
pnpm --dir packages/pod-dbt-mcp test   # the server alone, with a stand-in orca
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-mcp-smoke.mjs   # against pnpm dev on port 9333
```

## Folder-workspace coordinator (Phase 4)

`orchestration-folder-worker-smoke.mjs` checks the folder-coordinator fix (`docs/pod/upstream/0001-...`) through the real `orca` CLI. It creates a throwaway folder workspace in the `pod-smoke` group, opens a terminal there, binds a fresh run to it, and runs `orca orchestration worker-start --worktree new-child --repo id:<dbt-demo>`. It expects the worker's worktree in `dbt-demo` with the folder workspace as its parent (read from `window.api.worktrees.listLineage()`) and the worker started with `--dangerously-skip-permissions`, then expects the same call without `--repo` to answer with what to pass. Claude's command points at a `/bin/sh` stand-in that writes its arguments to a temp file and then waits on `/bin/cat`, so no agent starts and no usage is spent; the worker then stalls at prompt delivery, which the script expects. It removes the worktree, the terminal and the folder workspace and restores the agent settings afterwards. On the code before the fix the first `worker-start` fails with a bare `selector_not_found`.

```sh
pnpm build:cli
node docs/pod/smoke/orchestration-folder-worker-smoke.mjs   # against pnpm dev on port 9333, after ui-smoke.mjs
```

**Parked until every phase has shipped:** a Claude Code worker, launched through an Initiative, running the `ae-dbt` skill's `orca dbt` commands on its own in a smoke initiative. The commands are tested by hand and by unit tests; what is unproven is an agent choosing them unprompted. It costs Claude usage and a full initiative run, so it comes after Phase 4, and every resume doc carries this line until it is done.

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

## First setup

`ui-setup-smoke.mjs` makes two throwaway repos under `~/Projects/pod-smoke/setup/` (`dbt-setup` with `profiles.yml` at its root, a `prod` default target and a fake keyfile path; `omni-setup` with `model.yaml`), puts a broken `dbt` shim in `dbt-setup/.venv/bin` and the stand-in `dbt` in `setup/.venv/bin`, then opens Settings > Analytics Tools > Tools > Set up from repos and gives it only the dbt repo. Setup must run by itself, with no Detect step: it checks that the broken shim is skipped and named in plain words, the root `profiles.yml` is found, the only question is the `prod` default, no credential shows and nothing is written while the question is open. It picks `dev` and checks the result screen, the domain's target and profiles folder and the dbt tool path, then adds the Omni repo from the result screen and checks both roles. A last run must leave the domain's `updatedAt` alone. It restores the tool settings afterwards. Two screenshots: `setup-1-question`, `setup-2-applied`.

```sh
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-setup-smoke.mjs   # against pnpm dev on port 9333
```

## First start

`ui-first-start-smoke.mjs` reads the dev instance's settings and checks that loading the profile cleared a saved Claude bypass default (`podClaudeBypassDefaultCleared`) and that Claude's arguments do not start with `--dangerously-skip-permissions`. It then activates `dbt-demo`'s `master` worktree, opens the tab bar's "New tab" menu and checks that it offers a terminal and nothing about the Mobile Emulator, item or intro. On the code before the change both checks fail: the profile still carries Orca's default, and the menu lists "New Mobile Emulator". One screenshot: `first-start-new-tab-menu`.

```sh
POD_SMOKE_OUT=/tmp node docs/pod/smoke/ui-first-start-smoke.mjs   # against pnpm dev on port 9333, after ui-smoke.mjs
```
