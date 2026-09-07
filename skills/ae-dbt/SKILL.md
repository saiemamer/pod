---
name: ae-dbt
description: >-
  Change dbt models as a Pod worker: find the project, run dbt through the path Pod
  configured with the domain's profile and target, build only what you changed, test
  it, and report the columns downstream Omni work depends on. Use when your repo role
  is dbt or a task names models, sources, seeds or snapshots.
---

# dbt work in Pod

This file is a discovery stub. The full guide is served by the `orca` binary:

```sh
orca skills get ae-dbt
```

Load it when your repo role is dbt or a task names models, sources, seeds or
snapshots. The guide covers finding the project, running dbt with the domain's
profile and target, building only what changed, testing, and the column report the
Omni worker after you needs.
