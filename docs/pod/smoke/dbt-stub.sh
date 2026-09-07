#!/bin/sh
# Stand-in for dbt Core: answers show, compile, parse and docs generate with canned output.
# The manifest is source -> stg_orders -> {orders -> order_summary, orders_by_customer}, so the canvas,
# column lineage and the Database explorer have something to draw.
sleep 1
case " $* " in
  *" parse "*) mkdir -p target; cat > target/manifest.json <<'EOF'
{"metadata": {"dbt_version": "1.9.0", "generated_at": "2026-09-07T14:00:00Z", "project_name": "demo"},
 "nodes": {
  "model.demo.orders": {"name": "orders", "resource_type": "model", "package_name": "demo", "path": "marts/orders.sql", "original_file_path": "models/marts/orders.sql", "database": "proj", "schema": "dbt", "alias": "orders", "relation_name": "`proj`.`dbt`.`orders`", "config": {"materialized": "table"}, "depends_on": {"nodes": ["model.demo.stg_orders"]}},
  "model.demo.stg_orders": {"name": "stg_orders", "resource_type": "model", "package_name": "demo", "path": "stg_orders.sql", "original_file_path": "models/stg_orders.sql", "database": "proj", "schema": "dbt", "alias": "stg_orders", "relation_name": "`proj`.`dbt`.`stg_orders`", "config": {"materialized": "view"}, "depends_on": {"nodes": ["source.demo.raw.orders"]}},
  "model.demo.orders_by_customer": {"name": "orders_by_customer", "resource_type": "model", "package_name": "demo", "path": "marts/orders_by_customer.sql", "original_file_path": "models/marts/orders_by_customer.sql", "database": "proj", "schema": "dbt", "alias": "orders_by_customer", "relation_name": "`proj`.`dbt`.`orders_by_customer`", "config": {"materialized": "view"}, "depends_on": {"nodes": ["model.demo.stg_orders"]}},
  "model.demo.order_summary": {"name": "order_summary", "resource_type": "model", "package_name": "demo", "path": "marts/order_summary.sql", "original_file_path": "models/marts/order_summary.sql", "database": "proj", "schema": "dbt", "alias": "order_summary", "relation_name": "`proj`.`dbt`.`order_summary`", "config": {"materialized": "incremental"}, "depends_on": {"nodes": ["model.demo.orders"]}}
 },
 "sources": {
  "source.demo.raw.orders": {"name": "orders", "resource_type": "source", "package_name": "demo", "path": "models/sources.yml", "original_file_path": "models/sources.yml", "database": "proj", "schema": "raw", "identifier": "orders_raw", "relation_name": "`proj`.`raw`.`orders_raw`", "columns": {"id": {"name": "id", "data_type": "INT64"}, "status": {"name": "status", "data_type": "STRING"}, "amount": {"name": "amount", "data_type": "FLOAT64"}}}
 },
 "parent_map": {"model.demo.orders": ["model.demo.stg_orders"], "model.demo.orders_by_customer": ["model.demo.stg_orders"], "model.demo.stg_orders": ["source.demo.raw.orders"], "model.demo.order_summary": ["model.demo.orders"], "source.demo.raw.orders": []},
 "child_map": {"model.demo.stg_orders": ["model.demo.orders", "model.demo.orders_by_customer"], "model.demo.orders": ["model.demo.order_summary"], "source.demo.raw.orders": ["model.demo.stg_orders"], "model.demo.order_summary": [], "model.demo.orders_by_customer": []}}
EOF
  exit 0 ;;
  *" docs generate "*) mkdir -p target; cat > target/catalog.json <<'EOF'
{"metadata": {"generated_at": "2026-09-07T14:05:00Z", "dbt_version": "1.9.0"},
 "nodes": {
  "model.demo.orders": {"metadata": {"type": "table", "schema": "dbt", "name": "orders", "database": "proj"}, "columns": {"order_id": {"type": "INT64", "index": 1, "name": "order_id"}, "status": {"type": "STRING", "index": 2, "name": "status"}, "amount": {"type": "FLOAT64", "index": 3, "name": "amount"}}},
  "model.demo.stg_orders": {"metadata": {"type": "view", "schema": "dbt", "name": "stg_orders", "database": "proj"}, "columns": {"order_id": {"type": "INT64", "index": 1, "name": "order_id"}, "status": {"type": "STRING", "index": 2, "name": "status"}, "amount": {"type": "FLOAT64", "index": 3, "name": "amount"}}},
  "model.demo.orders_by_customer": {"metadata": {"type": "view", "schema": "dbt", "name": "orders_by_customer", "database": "proj"}, "columns": {"order_id": {"type": "INT64", "index": 1, "name": "order_id"}, "status": {"type": "STRING", "index": 2, "name": "status"}, "amount": {"type": "FLOAT64", "index": 3, "name": "amount"}}},
  "model.demo.order_summary": {"metadata": {"type": "table", "schema": "dbt", "name": "order_summary", "database": "proj"}, "columns": {"status": {"type": "STRING", "index": 1, "name": "status"}, "n": {"type": "INT64", "index": 2, "name": "n"}}}
 },
 "sources": {
  "source.demo.raw.orders": {"metadata": {"type": "table", "schema": "raw", "name": "orders_raw", "database": "proj"}, "columns": {"id": {"type": "INT64", "index": 1, "name": "id"}, "status": {"type": "STRING", "index": 2, "name": "status"}, "amount": {"type": "FLOAT64", "index": 3, "name": "amount"}}}
 }}
EOF
  exit 0 ;;
  *" show "*"--inline"*) echo '{"show": [{"n": 2, "label": "inline"}]}'; exit 0 ;;
  *" show "*) echo "12:00:00  Running with dbt=1.9.0"; echo '{"show": [{"order_id": 1, "customer_id": 7, "status": "paid", "amount": 12.5}, {"order_id": 2, "customer_id": 9, "status": "shipped", "amount": null}, {"order_id": 3, "customer_id": 7, "status": "paid", "amount": 3.25}]}'; exit 0 ;;
  *" compile "*"--inline"*) echo '{"data": {"node_name": "inline_query", "compiled": "select 2 as n"}, "info": {"name": "CompiledNode", "level": "info", "msg": "x"}}'; exit 0 ;;
  *" compile "*) echo '{"data": {"node_name": "orders", "compiled": "with source as (\n    select * from `proj`.`dbt`.`stg_orders`\n)\nselect * from source"}, "info": {"name": "CompiledNode", "level": "info", "msg": "x"}}'; exit 0 ;;
esac
echo "unknown dbt call: $*" >&2; exit 1
