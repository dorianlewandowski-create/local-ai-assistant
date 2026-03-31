#!/usr/bin/env bash
set -e

# @describe Sync open SQLite tasks with Apple Reminders.

# @option --list-name The target reminders list (default "AI Assistant").

# @env LLM_OUTPUT=/dev/stdout The output path

AGENT_DIR="${LLM_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../agents/personal-assistant" && pwd)}"
ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

db_path() {
    printf '%s\n' "$HOME/Notes/assistant.db"
}

main() {
    local list_name="${argc_list_name:-AI Assistant}"
    local sqlite_tasks reminders

    # Get open tasks from SQLite
    sqlite_tasks=$(sqlite3 "$(db_path)" "SELECT title FROM tasks WHERE status = 'open';")
    
    # Get incomplete reminders from Apple Reminders
    reminders=$(osascript "$AGENT_DIR/reminders_list_items.applescript" "$list_name" "false")

    # Sync: Create missing reminders
    while IFS= read -r task_title; do
        if [[ -z "$task_title" ]]; then continue; fi
        if [[ "$reminders" != *"$task_title"* ]]; then
            echo "Syncing: Creating reminder for '$task_title'" >> "$LLM_OUTPUT"
            osascript "$AGENT_DIR/reminders_create_item.applescript" "$task_title" "$list_name" "" ""
        fi
    done <<< "$sqlite_tasks"

    echo "Sync complete for list '$list_name'." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
