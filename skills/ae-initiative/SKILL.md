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

This file is a discovery stub. The full guide is served by the `orca` binary that
runs your commands, so it never drifts from it:

```sh
orca skills get ae-initiative
```

Load it whenever you are the main agent of a Pod domain, sit in a domain or
initiative folder, or a request spans the dbt and Omni repos of one domain. The guide
covers orienting with `orca domain show`, planning parts into `INITIATIVE.md`,
creating the run, dispatching dbt workers before Omni workers, waiting on
`worker_done` and `escalation`, and reporting.
