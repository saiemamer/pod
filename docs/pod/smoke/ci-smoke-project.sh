#!/bin/sh
# Builds the sample project the click-through scripts read (see README.md) in the folder given,
# from this repo only: the stand-in dbt at bin/dbt, dbt-demo and omni-demo as one-commit repos.
# GitHub's Pod UI smoke job runs it on a clean runner; ui-lineage-smoke.mjs adds the rest of the models.
set -eu
dest=${1:?usage: ci-smoke-project.sh <folder>}
here=$(cd "$(dirname "$0")" && pwd)
if [ -e "$dest/dbt-demo" ] || [ -e "$dest/omni-demo" ]; then
  echo "ci-smoke-project: $dest already holds the sample repos" >&2
  exit 1
fi

commit_all() {
  git add -A
  git -c user.name='Pod smoke' -c user.email=pod-smoke@example.invalid -c commit.gpgsign=false \
    commit -qm init
}

mkdir -p "$dest/bin" "$dest/dbt-demo/models/marts" "$dest/omni-demo"
cp "$here/dbt-stub.sh" "$dest/bin/dbt"
chmod +x "$dest/bin/dbt"

cd "$dest/dbt-demo"
git -c init.defaultBranch=master init -q
printf 'name: demo\nprofile: demo\n' > dbt_project.yml
printf "{{ config(materialized='table') }}\n\nwith source as (\n    select * from {{ ref('stg_orders') }}\n),\n\nfinal as (\n    select\n        order_id,\n        status,\n        amount\n    from source\n    where status != 'cancelled'\n)\n\nselect * from final\n" > models/marts/orders.sql
printf "select 1 as order_id, 'paid' as status\n" > models/stg_orders.sql
commit_all

cd "$dest/omni-demo"
git -c init.defaultBranch=master init -q
printf 'name: demo\n' > model.yaml
commit_all
