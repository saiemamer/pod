#!/bin/sh
# Stand-in for Pod's `orca` CLI: logs its arguments and cwd, answers like `--json` does.
printf '%s|%s\n' "$PWD" "$*" >> "$ORCA_STUB_LOG"
case " $* " in
  *" --model broken "*)
    echo '{"id":"local","ok":false,"error":{"code":"runtime_error","message":"Compilation Error in model broken"}}'
    exit 1 ;;
  *" dbt lineage "*)
    echo '{"id":"1","ok":true,"result":{"model":"orders","nodes":[{"name":"stg_orders"},{"name":"orders"}]}}' ;;
  *)
    echo '{"id":"1","ok":true,"result":{"echo":true}}' ;;
esac
