#!/bin/sh
# Stand-in for the Omni CLI (github.com/exploreomni/cli) for Pod's smoke runs: answers
# the `omni models` subcommands Pod uses with JSON shaped like Omni's OpenAPI spec, and
# keeps created branches in a state directory. It never touches the network.
state="${POD_OMNI_STUB_STATE:-${TMPDIR:-/tmp}/pod-omni-stub}"
mkdir -p "$state"
touch "$state/branches"
token=no
[ -n "$OMNI_API_TOKEN" ] && token=yes
printf 'token=%s %s\n' "$token" "$*" >> "$state/calls.log"

if [ "$token" = no ]; then
  echo '{"error":"Unauthorized","status":401,"body":{"detail":"Unauthorized: Missing or invalid API key","status":401}}' >&2
  exit 1
fi

model_id=11111111-1111-4111-8111-111111111111
group="$1"
cmd="$2"
shift 2 2>/dev/null
pos1=""
pos2=""
branch_id=""
name=""
body=""
with_branches=no
filter_model=""
cursor=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch-id) branch_id="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    --model-id) filter_model="$2"; shift 2 ;;
    --include) [ "$2" = activeBranches ] && with_branches=yes; shift 2 ;;
    --cursor) cursor="$2"; shift 2 ;;
    --format | --page-size) shift 2 ;;
    --compact) shift ;;
    --*) shift ;;
    *) if [ -z "$pos1" ]; then pos1="$1"; else pos2="$1"; fi; shift ;;
  esac
done

branches_json() {
  printf '{"id":"b0000000-0000-4000-8000-000000000099","name":"someone-else"}'
  while read -r id bname; do
    [ -n "$id" ] && printf ',{"id":"%s","name":"%s"}' "$id" "$bname"
  done < "$state/branches"
}

if [ "$group" != models ]; then
  echo "Error: unknown command \"$group\" for \"omni\"" >&2
  exit 1
fi

case "$cmd" in
  list)
    if [ -n "$filter_model" ] && [ "$with_branches" = yes ]; then
      printf '{"pageInfo":{"hasNextPage":false,"nextCursor":null,"pageSize":100,"totalRecords":1},"records":[{"id":"%s","name":"mex","modelKind":"SHARED","connectionId":"c1","baseModelId":null,"createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-10-01T00:00:00Z","deletedAt":null,"branches":[%s]}]}\n' "$model_id" "$(branches_json)"
    elif [ "$POD_OMNI_STUB_MODELS" = endless-schema ]; then
      # Why: no shared model and a cursor that never ends, for the picker's empty and capped notes.
      echo '{"pageInfo":{"hasNextPage":true,"nextCursor":"more","pageSize":100,"totalRecords":5000},"records":[{"id":"22222222-2222-4222-8222-222222222222","name":"bigquery schema","modelKind":"SCHEMA","connectionId":"c1","baseModelId":null,"createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-02T00:00:00Z","deletedAt":null}]}'
    elif [ "$cursor" = page-2 ]; then
      echo '{"pageInfo":{"hasNextPage":false,"nextCursor":null,"pageSize":100,"totalRecords":3},"records":[{"id":"22222222-2222-4222-8222-222222222222","name":"bigquery schema","modelKind":"SCHEMA","connectionId":"c1","baseModelId":null,"createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-02T00:00:00Z","deletedAt":null},{"id":"33333333-3333-4333-8333-333333333333","name":"mex sandbox","modelKind":"SHARED_EXTENSION","connectionId":"c1","baseModelId":"11111111-1111-4111-8111-111111111111","createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-09-03T00:00:00Z","deletedAt":null}]}'
    else
      # Why two pages: Pod must follow pageInfo.nextCursor, as the real CLI pages at 100.
      printf '{"pageInfo":{"hasNextPage":true,"nextCursor":"page-2","pageSize":100,"totalRecords":3},"records":[{"id":"%s","name":"mex","modelKind":"SHARED","connectionId":"c1","baseModelId":null,"createdAt":"2026-09-01T00:00:00Z","updatedAt":"2026-10-01T00:00:00Z","deletedAt":null}]}\n' "$model_id"
    fi
    ;;
  create-branch)
    count=$(wc -l < "$state/branches" | tr -d ' ')
    id="b0000000-0000-4000-8000-00000000000$((count + 1))"
    printf '%s %s\n' "$id" "$name" >> "$state/branches"
    printf '{"success":true,"model":{"id":"%s","modelKind":"BRANCH","name":"%s"}}\n' "$id" "$name"
    ;;
  validate)
    if [ -n "$branch_id" ]; then
      echo '{"valid":false,"issues":[{"message":"Unknown field \"tickets.channel_name\" in measure \"tickets.count_by_channel\"","severity":"error","view":"tickets","field":"count_by_channel"},{"message":"Field \"tickets.legacy_status\" has no description","severity":"warning","view":"tickets","field":"legacy_status"}]}'
    else
      echo '{"valid":true,"issues":[]}'
    fi
    ;;
  commit)
    case "$body" in
      *branch_id*commit_message*) ;;
      *) echo '{"error":"Bad Request","status":400,"body":{"detail":"branch_id and commit_message are required","status":400}}' >&2; exit 1 ;;
    esac
    echo '{"did_sync":true,"git_sha":"4f2c9e1","in_sync":true,"pr_url":"https://git.example.invalid/omni-demo/pull/7"}'
    ;;
  list-topics)
    extra=""
    [ -n "$branch_id" ] && extra=',{"name":"ticket_channels","label":"Ticket channels","base_view_name":"ticket_channels","description":"Added on this branch"}'
    printf '{"success":true,"topics":[{"name":"tickets","label":"Tickets","base_view_name":"tickets","description":"Support tickets with their latest status","group_label":"Support"},{"name":"customers","label":"Customers","base_view_name":"customers"},{"name":"legacy_tickets","label":"Legacy tickets","base_view_name":"zendesk_tickets","hidden":true}%s]}\n' "$extra"
    ;;
  get-topic)
    if [ "$pos2" = missing ]; then
      echo '{"error":"Not Found","status":404,"body":{"detail":"Topic missing not found","status":404}}' >&2
      exit 1
    fi
    printf '{"success":true,"topic":{"name":"%s","label":"Tickets","base_view_name":"tickets","description":"Support tickets with their latest status","views":[{"name":"tickets","label":"Tickets","dimensions":[{"field_name":"ticket_id"},{"field_name":"channel"},{"field_name":"created_at"}],"measures":[{"field_name":"count"},{"field_name":"avg_resolution_hours"}]},{"name":"customers","label":"Customers","dimensions":[{"field_name":"customer_id"},{"field_name":"segment"}],"measures":[{"field_name":"count"}]}],"relationships":[{"left_view_name":"tickets","right_view_name":"customers","join_type":"always_left","type":"many_to_one"}]}}\n' "$pos2"
    ;;
  *)
    echo "Error: unknown command \"$cmd\" for \"omni models\"" >&2
    exit 1
    ;;
esac
