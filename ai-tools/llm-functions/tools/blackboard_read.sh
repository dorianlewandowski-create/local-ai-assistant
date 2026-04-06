#!/usr/bin/env bash
set -e

# @describe Read information from the shared agent blackboard.
# @option --task-id The unique ID of the task (default: "default").
# @option --key Filter by a specific data key.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local task_id="${argc_task_id:-"default"}"
    local db_path="$HOME/Notes/assistant.db"
    local query="SELECT agent_name, key, value, created_at FROM blackboard WHERE task_id = '$task_id'"

    if [[ -n "$argc_key" ]]; then
        query="$query AND key = '$argc_key'"
    fi

    query="$query ORDER BY created_at ASC;"

    echo "### Shared Blackboard State (Task: $task_id)" >> "$LLM_OUTPUT"
    sqlite3 -header -column "$db_path" "$query" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
