/**
 * Pod: the sqlglot sidecar, kept as a string so every bundler (Vite for the app, esbuild
 * for the orcad daemon, vitest) ships it without a loader. Handed to Python with -c;
 * the models arrive on stdin. See dbt-sqlglot-sidecar.ts for the contract.
 */
export const SQLGLOT_LINEAGE_SCRIPT = `"""Pod: column lineage for dbt models through sqlglot.

Reads one JSON document on stdin:

  {"dialect": "bigquery",
   "nodes": [{"id": "model.demo.orders",
              "sql": "select ... from \`proj\`.\`dbt\`.\`stg_orders\`",
              "schema": {"proj.dbt.stg_orders": ["order_id", "status"]}}]}

and prints one JSON document: for every node, its output column names and, per
output column, the (relation, column) pairs it is computed from. Relations are
named the way the SQL names them, so the caller maps them back to dbt nodes.

Exit code 3 means sqlglot cannot be imported; the caller falls back to name
matching. Every other failure is reported per node, so one odd model does not
take the whole request down. The script never reads a file or the network.
"""

import json
import sys


def nested_schema(flat):
    """{"a.b.c": ["x"]} -> {"a": {"b": {"c": {"x": "UNKNOWN"}}}}, as sqlglot wants it."""
    schema = {}
    for key, columns in flat.items():
        level = schema
        parts = key.split(".")
        for part in parts[:-1]:
            level = level.setdefault(part, {})
        level[parts[-1]] = {column: "UNKNOWN" for column in columns}
    return schema


def relation_of(table):
    return ".".join(part for part in (table.catalog, table.db, table.name) if part)


def analyse(node, dialect, sqlglot, exp, lineage, qualify):
    sql = node.get("sql") or ""
    schema = nested_schema(node.get("schema") or {})
    try:
        expression = sqlglot.parse_one(sql, read=dialect)
        qualified = qualify(expression.copy(), schema=schema, dialect=dialect)
        outputs = list(qualified.named_selects)
    except Exception as error:  # noqa: BLE001 - reported to the caller
        return {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}
    columns = {}
    errors = {}
    for name in outputs:
        try:
            root = lineage(name, sql, schema=schema, dialect=dialect)
        except Exception as error:  # noqa: BLE001
            errors[name] = "%s: %s" % (type(error).__name__, error)
            columns[name] = []
            continue
        refs = []
        for item in root.walk():
            if item.downstream:
                continue
            source = item.source
            if isinstance(source, exp.Table):
                ref = {
                    "relation": relation_of(source),
                    "column": item.name.rsplit(".", 1)[-1],
                }
                if ref not in refs:
                    refs.append(ref)
        columns[name] = refs
    result = {"ok": True, "outputs": outputs, "columns": columns}
    if errors:
        result["errors"] = errors
    return result


def main():
    payload = json.load(sys.stdin)
    try:
        import sqlglot
        from sqlglot import exp
        from sqlglot.lineage import lineage
        from sqlglot.optimizer.qualify import qualify
    except Exception as error:  # noqa: BLE001 - a missing or broken install
        print(json.dumps({"ok": False, "error": "sqlglot is not importable: %s" % error}))
        sys.exit(3)
    dialect = payload.get("dialect") or None
    out = {"ok": True, "sqlglot": sqlglot.__version__, "nodes": {}}
    for node in payload.get("nodes") or []:
        out["nodes"][node["id"]] = analyse(node, dialect, sqlglot, exp, lineage, qualify)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
`
