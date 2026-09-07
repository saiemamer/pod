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
