#!/bin/sh
# Stand-in for dbt Core: answers show, compile and parse with canned output.
sleep 1
case " $* " in
  *" parse "*) mkdir -p target; printf '{"metadata": {"dbt_version": "1.9.0", "generated_at": "2026-09-07T14:00:00Z", "project_name": "demo"}, "nodes": {"model.demo.orders": {"name": "orders", "resource_type": "model", "package_name": "demo", "path": "marts/orders.sql", "original_file_path": "models/marts/orders.sql", "config": {"materialized": "table"}, "depends_on": {"nodes": ["model.demo.stg_orders"]}}, "model.demo.stg_orders": {"name": "stg_orders", "resource_type": "model", "package_name": "demo", "path": "stg_orders.sql", "original_file_path": "models/stg_orders.sql", "depends_on": {"nodes": []}}}, "sources": {}, "parent_map": {"model.demo.orders": ["model.demo.stg_orders"]}, "child_map": {"model.demo.stg_orders": ["model.demo.orders"]}}' > target/manifest.json; exit 0 ;;
  *" show "*"--inline"*) echo '{"show": [{"n": 2, "label": "inline"}]}'; exit 0 ;;
  *" show "*) echo "12:00:00  Running with dbt=1.9.0"; echo '{"show": [{"order_id": 1, "customer_id": 7, "status": "paid", "amount": 12.5}, {"order_id": 2, "customer_id": 9, "status": "shipped", "amount": null}, {"order_id": 3, "customer_id": 7, "status": "paid", "amount": 3.25}]}'; exit 0 ;;
  *" compile "*"--inline"*) echo '{"data": {"node_name": "inline_query", "compiled": "select 2 as n"}, "info": {"name": "CompiledNode", "level": "info", "msg": "x"}}'; exit 0 ;;
  *" compile "*) echo '{"data": {"node_name": "orders", "compiled": "with source as (\n    select * from `proj`.`dbt`.`stg_orders`\n)\nselect * from source"}, "info": {"name": "CompiledNode", "level": "info", "msg": "x"}}'; exit 0 ;;
esac
echo "unknown dbt call: $*" >&2; exit 1
