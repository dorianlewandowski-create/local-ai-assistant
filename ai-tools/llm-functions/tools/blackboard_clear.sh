#!/usr/bin/env bash
set -e

# @describe Clear entries from the shared agent blackboard.
# @option --task-id Clear only entries for a specific task ID.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local db_path="$HOME/Notes/assistant.db"
    
    if [[ -n "$argc_task_id" ]]; then
        echo "Clearing blackboard for task: $argc_task_id" >> "$LLM_OUTPUT"
        sqlite3 "$db_path" "DELETE FROM blackboard WHERE task_id = '$argc_task_id';"
    else
        echo "Clearing entire blackboard..." >> "$LLM_OUTPUT"
        sqlite3 "$db_path" "DELETE FROM blackboard;"
    fi

    echo "Blackboard cleared." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
