# sqlglot, shipped with Pod

Pod's column lineage runs `sqlglot` in a Python the person already has. This folder is the
copy it imports, put first on `PYTHONPATH` by `src/main/ae/dbt/dbt-sqlglot-sidecar.ts`, so
nobody installs sqlglot and every laptop gets the same answers.

- Version: sqlglot 30.21.0, from PyPI's pure-Python wheel
  `sqlglot-30.21.0-py3-none-any.whl` (sha256
  `816d1a4815b7562b3976efcc0b561c928a743f976efd0fb8ad6db7a5b96c069e`). Needs Python 3.9 or later.
- Licence: MIT, copyright Toby Mao; the full text is `LICENSE` beside this file.
- `sqlglot/` is the wheel's package folder unchanged. No `.dist-info`, no compiled files.

To update, take the wheel (not the sdist) for the new version from
https://pypi.org/project/sqlglot/#files, check its sha256 against PyPI, then:

```sh
rm -rf resources/pod-sqlglot/sqlglot
unzip -q sqlglot-X.Y.Z-py3-none-any.whl 'sqlglot/*' -d resources/pod-sqlglot
unzip -p sqlglot-X.Y.Z-py3-none-any.whl 'sqlglot-X.Y.Z.dist-info/licenses/LICENSE' > resources/pod-sqlglot/LICENSE
```

Update the version and hash above and the version `dbt-column-lineage.test.ts` expects, then run the gated test with a Python that has no
sqlglot of its own:
`POD_SQLGLOT_PYTHON=/usr/bin/python3 pnpm test:pod src/main/ae/dbt/dbt-column-lineage.test.ts`.
