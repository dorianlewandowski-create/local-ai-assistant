#!/usr/bin/env bash
set -e

# @describe Post information to the shared agent blackboard.
# @option --key! The name of the data entry (e.g. "calendar_summary").
# @option --value! The actual data or findings.
# @option --task-id A unique ID to group related blackboard entries.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local agent="${LLM_AGENT_NAME:-"unknown"}"
    local key="$argc_key"
    local value="$argc_value"
    local task_id="${argc_task_id:-"default"}"
    local db_path="$HOME/Notes/assistant.db"

    echo "Posting to blackboard: $key..." >> "$LLM_OUTPUT"

    # Upsert logic: Update if task_id and key match for the same agent, else insert
    sqlite3 "$db_path" <<EOF
INSERT INTO blackboard (agent_name, key, value, task_id)
VALUES ('$agent', '$key', '$value', '$task_id');
EOF

    echo "Blackboard updated for agent '$agent'." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
