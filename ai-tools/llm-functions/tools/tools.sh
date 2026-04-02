#!/usr/bin/env bash
set -euo pipefail

# @env LLM_OUTPUT=/dev/stdout The output path

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../.." && pwd)"

parse_datetime() {
    python3 "$ROOT_DIR/utils/parse_natural_datetime.py" "$1"
}

db_path() {
    printf '%s\n' "$HOME/Notes/assistant.db"
}

normalize_slug() {
    python3 - <<'PY' "$1"
import re
import sys
print(re.sub(r'[^a-z0-9]+', '-', sys.argv[1].lower()).strip('-'))
PY
}

# @cmd Search the web for recent information.
# @option --query! The search query.
# @option --limit <INT> The maximum number of results to return.
# @option --source-filter Optional source filter like docs, github, news, or a domain fragment.
web_search() {
    local limit="${argc_limit:-5}"
    "$AGENT_DIR/web_search.sh" "$argc_query" "$limit" "${argc_source_filter:-}" >> "$LLM_OUTPUT"
}

# @cmd Fetch and simplify the contents of a URL.
# @option --url! The URL to fetch.
fetch_url() {
    "$AGENT_DIR/fetch_url.sh" "$argc_url" >> "$LLM_OUTPUT"
}

# @cmd Search the local notes folder for matching text.
# @option --query! The text to search for.
note_search() {
    local notes_dir="${NOTES_DIR:-$HOME/Notes}"
    "$AGENT_DIR/note_search.sh" "$argc_query" "$notes_dir" >> "$LLM_OUTPUT"
}

# @cmd Move or rename a file or directory.
# @option --source! The source path.
# @option --destination! The destination path.
fs_move() {
    "$ROOT_DIR/bin/fs_mv" --source "$argc_source" --destination "$argc_destination" >> "$LLM_OUTPUT"
}

# @cmd Copy a file or directory.
# @option --source! The source path.
# @option --destination! The destination path.
# @option --recursive Boolean to indicate recursive copy.
fs_copy() {
    local recursive_arg=""
    if [[ -n "$argc_recursive" ]]; then
        recursive_arg="--recursive"
    fi
    "$ROOT_DIR/bin/fs_cp" --source "$argc_source" --destination "$argc_destination" $recursive_arg >> "$LLM_OUTPUT"
}

# @cmd Organize files by moving them into target directories based on patterns or extensions.
# @option --source-dir! The source directory.
# @option --target-dir! The target directory.
# @option --pattern Search pattern like "*.pdf".
# @option --extensions Comma-separated list of extensions.
fs_organize() {
    local pattern_arg=""
    if [[ -n "$argc_pattern" ]]; then
        pattern_arg="--pattern $argc_pattern"
    fi
    local extensions_arg=""
    if [[ -n "$argc_extensions" ]]; then
        extensions_arg="--extensions $argc_extensions"
    fi
    "$ROOT_DIR/bin/fs_organize" --source-dir "$argc_source_dir" --target-dir "$argc_target_dir" $pattern_arg $extensions_arg >> "$LLM_OUTPUT"
}

# @cmd Delegate a complex, multi-step request to the Workflow Agent.
# @option --request! The full request string to delegate.
delegate_to_workflow() {
    "$ROOT_DIR/bin/delegate_to_workflow" --request "$argc_request" >> "$LLM_OUTPUT"
}

# @cmd Check for calendar conflicts within a given time range.
# @option --start! The start date and time.
# @option --end! The end date and time.
# @option --calendar-name The optional calendar name.
calendar_check_conflicts() {
    "$ROOT_DIR/bin/calendar_check_conflicts" --start "$argc_start" --end "$argc_end" --calendar-name "${argc_calendar_name:-}" >> "$LLM_OUTPUT"
}

# @cmd Find free time slots on a given date.
# @option --date! The date to check.
# @option --duration-minutes! The required duration.
# @option --start-hour <INT> The start hour (default 9).
# @option --end-hour <INT> The end hour (default 18).
# @option --calendar-name The optional calendar name.
calendar_find_free_slots() {
    local start_hour="${argc_start_hour:-9}"
    local end_hour="${argc_end_hour:-18}"
    "$ROOT_DIR/bin/calendar_find_free_slots" --date "$argc_date" --duration-minutes "$argc_duration_minutes" --start-hour "$start_hour" --end-hour "$end_hour" --calendar-name "${argc_calendar_name:-}" >> "$LLM_OUTPUT"
}

# @cmd Sync open SQLite tasks with Apple Reminders.
# @option --list-name The target reminders list (default "AI Assistant").
sync_tasks_reminders() {
    "$ROOT_DIR/bin/sync_tasks_reminders" --list-name "${argc_list_name:-AI Assistant}" >> "$LLM_OUTPUT"
}

# @cmd Sync project notes in Markdown to the SQLite assistant database.
# @option --notes-dir The root notes directory.
sync_notes_to_db() {
    "$ROOT_DIR/bin/sync_markdown_to_sqlite" --notes-dir "${argc_notes_dir:-$HOME/Notes}" >> "$LLM_OUTPUT"
}

# @cmd Bidirectional sync between project Markdown notes and SQLite assistant database.
# @option --notes-dir The root notes directory.
sync_projects() {
    "$ROOT_DIR/bin/sync_projects_bidirectional" --notes-dir "${argc_notes_dir:-$HOME/Notes}" >> "$LLM_OUTPUT"
}

# @cmd Use vision analysis to categorize and organize a file into project or research assets.
# @option --file-path! The path of the image file to organize.
# @option --target-type The explicit target type (project or research).
vision_organize() {
    "$ROOT_DIR/bin/vision_analyze_organize" --file-path "$argc_file_path" --target-type "${argc_target_type:-}" >> "$LLM_OUTPUT"
}

# @cmd Perform a deep, multi-turn autonomous research investigation.
# @option --topic! The high-level topic.
# @option --initial-query! The starting search query.
# @option --depth <INT> The number of research iterations (default 2).
deep_research() {
    "$ROOT_DIR/bin/deep_research" --topic "$argc_topic" --initial-query "$argc_initial_query" --depth "${argc_depth:-2}" >> "$LLM_OUTPUT"
}

# @cmd Get the URL and title of the active tab in Safari or Chrome.
# @option --browser <STRING> The browser (safari or chrome). Defaults to safari.
browser_get_active_tab() {
    "$ROOT_DIR/bin/browser_get_active_tab" --browser "${argc_browser:-safari}" >> "$LLM_OUTPUT"
}

# @cmd Check if the active browser tab relates to any active project.
# @option --browser <STRING> The browser (safari or chrome). Defaults to safari.
browser_project_match() {
    "$ROOT_DIR/bin/browser_project_match" --browser "${argc_browser:-safari}" >> "$LLM_OUTPUT"
}

# @cmd Read structured project status from the SQLite assistant database.
# @option --slug! The project slug.
db_project_status() {
    local slug
    slug="$(normalize_slug "$argc_slug")"
    sqlite3 "$(db_path)" "SELECT slug, title, status, owner, health_score, health_label FROM projects WHERE slug = '$slug' LIMIT 1;" >> "$LLM_OUTPUT"
}

# @cmd Read structured project tasks from the SQLite assistant database.
# @option --slug! The project slug.
db_project_tasks() {
    local slug
    slug="$(normalize_slug "$argc_slug")"
    sqlite3 "$(db_path)" "SELECT t.title, t.status, t.priority FROM tasks t JOIN projects p ON t.project_id = p.id WHERE p.slug = '$slug' ORDER BY t.id;" >> "$LLM_OUTPUT"
}

# @cmd Read recent project decisions from the SQLite assistant database.
# @option --slug! The project slug.
db_project_decisions() {
    local slug
    slug="$(normalize_slug "$argc_slug")"
    sqlite3 "$(db_path)" "SELECT d.decision, d.reason, d.created_at FROM decisions d JOIN projects p ON d.project_id = p.id WHERE p.slug = '$slug' ORDER BY d.created_at DESC LIMIT 10;" >> "$LLM_OUTPUT"
}

# @cmd Read structured research topic entries from the SQLite assistant database.
# @option --slug! The research topic slug.
db_research_topic() {
    local slug
    slug="$(normalize_slug "$argc_slug")"
    sqlite3 "$(db_path)" "SELECT rt.slug, ri.query, ri.source_domain, ri.source_url, ri.summary, ri.followups FROM research_items ri JOIN research_topics rt ON ri.topic_id = rt.id WHERE rt.slug = '$slug' ORDER BY ri.id;" >> "$LLM_OUTPUT"
}

# @cmd Consult another specialist agent for an opinion or information.
# @option --agent-name! The name of the agent to consult (pa, wa, fm, coder).
# @option --query! The specific question or task for the specialist.
consult_agent() {
    "$ROOT_DIR/bin/consult_agent" --agent-name "$argc_agent_name" --query "$argc_query" >> "$LLM_OUTPUT"
}

# @cmd Post information to the shared agent blackboard.
# @option --key! The data key.
# @option --value! The data value.
# @option --task-id Grouping ID.
blackboard_post() {
    "$ROOT_DIR/bin/blackboard_post" --key "$argc_key" --value "$argc_value" --task-id "${argc_task_id:-default}" >> "$LLM_OUTPUT"
}

# @cmd Read information from the shared agent blackboard.
# @option --task-id Grouping ID.
# @option --key Filter by key.
blackboard_read() {
    "$ROOT_DIR/bin/blackboard_read" --task-id "${argc_task_id:-default}" --key "${argc_key:-}" >> "$LLM_OUTPUT"
}

# @cmd Clear entries from the shared agent blackboard.
# @option --task-id Target grouping ID.
blackboard_clear() {
    "$ROOT_DIR/bin/blackboard_clear" --task-id "${argc_task_id:-}" >> "$LLM_OUTPUT"
}

# @cmd Log user feedback and corrections for future self-optimization.
# @option --feedback! The user's correction or feedback text.
log_feedback() {
    "$ROOT_DIR/bin/log_feedback" --agent-name "personal-assistant" --feedback "$argc_feedback" >> "$LLM_OUTPUT"
}

# @cmd Render professional terminal UI components (panels, tables, markdown).
# @option --type! The component type: panel, table, md.
# @option --content! The content to render.
# @option --title The title for the component.
# @option --style The color/style for the component (default: blue).
render_ui() {
    "$ROOT_DIR/bin/render_ui" --type "$argc_type" --content "$argc_content" --title "${argc_title:-}" --style "${argc_style:-blue}" >> "$LLM_OUTPUT"
}

# @cmd Read stale projects from the SQLite assistant database.
db_stale_projects() {
    sqlite3 "$(db_path)" "SELECT slug, status, updated_at FROM projects WHERE status != 'archived' AND COALESCE(updated_at, created_at) <= datetime('now', '-14 day') ORDER BY updated_at;" >> "$LLM_OUTPUT"
}

# @cmd Read recent meetings from the SQLite assistant database.
# @option --limit <INT> The number of meetings to return.
db_recent_meetings() {
    local limit="${argc_limit:-5}"
    sqlite3 "$(db_path)" "SELECT title, meeting_date, summary FROM meetings ORDER BY created_at DESC LIMIT $limit;" >> "$LLM_OUTPUT"
}

# @cmd Append a note to a Markdown file in the local notes folder.
# @option --file! The note file path, absolute or relative to the notes directory.
# @option --text! The text to append.
note_append() {
    local notes_dir="${NOTES_DIR:-$HOME/Notes}"
    "$AGENT_DIR/note_append.sh" "$argc_file" "$argc_text" "$notes_dir" "$ROOT_DIR" >> "$LLM_OUTPUT"
}

# @cmd List the available Apple Calendar calendars.
calendar_list_names() {
    osascript "$AGENT_DIR/calendar_list_names.applescript" >> "$LLM_OUTPUT"
}

# @cmd List Apple Calendar events from a starting date for a number of days.
# @option --start! The start date and time, for example 2026-03-29 00:00 or March 29 2026 9am.
# @option --days <INT> The number of days to include.
# @option --calendar-name The optional calendar name to limit results to.
calendar_list_events() {
    local days="${argc_days:-1}"
    local calendar_name="${argc_calendar_name:-${APPLE_CALENDAR_NAME:-}}"
    osascript "$AGENT_DIR/calendar_list_events.applescript" "$argc_start" "$days" "$calendar_name" >> "$LLM_OUTPUT"
}

# @cmd Create an Apple Calendar event.
# @option --title! The event title.
# @option --start! The event start date and time.
# @option --end! The event end date and time.
# @option --notes The optional event notes.
# @option --calendar-name The optional target calendar name.
calendar_create_event() {
    local calendar_name="${argc_calendar_name:-${APPLE_CALENDAR_NAME:-}}"
    local start_text="$argc_start"
    local end_text="$argc_end"
    start_text="$(parse_datetime "$start_text")"
    end_text="$(parse_datetime "$end_text")"
    "$ROOT_DIR/utils/guard_operation.sh" "Create calendar event '$argc_title'?"
    osascript "$AGENT_DIR/calendar_create_event.applescript" "$argc_title" "$start_text" "$end_text" "${argc_notes:-}" "$calendar_name" >> "$LLM_OUTPUT"
}

# @cmd Search Apple Calendar events by fuzzy title match.
# @option --query! The event title query.
# @option --days <INT> The number of days ahead to search.
# @option --calendar-name The optional calendar name to limit results to.
calendar_search_events() {
    local days="${argc_days:-30}"
    local calendar_name="${argc_calendar_name:-${APPLE_CALENDAR_NAME:-}}"
    osascript "$AGENT_DIR/calendar_search_events.applescript" "$argc_query" "$days" "$calendar_name" >> "$LLM_OUTPUT"
}

# @cmd Delete the first Apple Calendar event that fuzzy-matches a title.
# @option --query! The event title query.
# @option --days <INT> The number of days ahead to search.
# @option --calendar-name The optional calendar name to limit results to.
calendar_delete_event() {
    local days="${argc_days:-30}"
    local calendar_name="${argc_calendar_name:-${APPLE_CALENDAR_NAME:-}}"
    "$ROOT_DIR/utils/guard_operation.sh" "Delete calendar event matching '$argc_query'?"
    osascript "$AGENT_DIR/calendar_delete_event.applescript" "$argc_query" "$days" "$calendar_name" >> "$LLM_OUTPUT"
}

# @cmd Update the first Apple Calendar event that fuzzy-matches a title.
# @option --query! The event title query.
# @option --start The updated event start date and time.
# @option --end The updated event end date and time.
# @option --title The updated event title.
# @option --notes The updated event notes.
# @option --days <INT> The number of days ahead to search.
# @option --calendar-name The optional calendar name to limit results to.
calendar_update_event() {
    local days="${argc_days:-30}"
    local calendar_name="${argc_calendar_name:-${APPLE_CALENDAR_NAME:-}}"
    local start_text="${argc_start:-}"
    local end_text="${argc_end:-}"
    if [[ -n "$start_text" ]]; then
        start_text="$(parse_datetime "$start_text")"
    fi
    if [[ -n "$end_text" ]]; then
        end_text="$(parse_datetime "$end_text")"
    fi
    "$ROOT_DIR/utils/guard_operation.sh" "Update calendar event matching '$argc_query'?"
    osascript "$AGENT_DIR/calendar_update_event.applescript" "$argc_query" "$start_text" "$end_text" "${argc_title:-}" "${argc_notes:-}" "$days" "$calendar_name" >> "$LLM_OUTPUT"
}

# @cmd List the available Apple Reminders lists.
reminders_list_names() {
    osascript "$AGENT_DIR/reminders_list_names.applescript" >> "$LLM_OUTPUT"
}

# @cmd List Apple Reminders from an optional list.
# @option --list-name The optional reminders list name.
# @option --include-completed Include completed reminders.
reminders_list_items() {
    local list_name="${argc_list_name:-${APPLE_REMINDERS_LIST:-}}"
    local include_completed="false"
    if [[ -n "${argc_include_completed:-}" ]]; then
        include_completed="true"
    fi
    osascript "$AGENT_DIR/reminders_list_items.applescript" "$list_name" "$include_completed" >> "$LLM_OUTPUT"
}

# @cmd Create an Apple Reminder item.
# @option --title! The reminder title.
# @option --list-name The optional reminders list name.
# @option --notes The optional reminder notes.
# @option --due-date The optional due date and time.
reminders_create_item() {
    local list_name="${argc_list_name:-${APPLE_REMINDERS_LIST:-}}"
    local due_text="${argc_due_date:-}"
    if [[ -n "$due_text" ]]; then
        due_text="$(parse_datetime "$due_text")"
    fi
    "$ROOT_DIR/utils/guard_operation.sh" "Create reminder '$argc_title'?"
    osascript "$AGENT_DIR/reminders_create_item.applescript" "$argc_title" "$list_name" "${argc_notes:-}" "$due_text" >> "$LLM_OUTPUT"
}

# @cmd Complete the first matching Apple Reminder item by title.
# @option --title! The reminder title to complete.
# @option --list-name The optional reminders list name.
reminders_complete_item() {
    local list_name="${argc_list_name:-${APPLE_REMINDERS_LIST:-}}"
    "$ROOT_DIR/utils/guard_operation.sh" "Complete reminder '$argc_title'?"
    osascript "$AGENT_DIR/reminders_complete_item.applescript" "$argc_title" "$list_name" >> "$LLM_OUTPUT"
}

# @cmd Delete the first matching Apple Reminder item by title.
# @option --title! The reminder title to delete.
# @option --list-name The optional reminders list name.
reminders_delete_item() {
    local list_name="${argc_list_name:-${APPLE_REMINDERS_LIST:-}}"
    "$ROOT_DIR/utils/guard_operation.sh" "Delete reminder '$argc_title'?"
    osascript "$AGENT_DIR/reminders_delete_item.applescript" "$argc_title" "$list_name" >> "$LLM_OUTPUT"
}

# @cmd Send an email.
# @option --to! The recipient email.
# @option --subject! The email subject.
# @option --body! The email body.
send_mail() {
    "$ROOT_DIR/bin/send_mail" --to "$argc_to" --subject "$argc_subject" --body "$argc_body" >> "$LLM_OUTPUT"
}

# @cmd Get the most recent emails from the inbox.
# @option --limit <INT> The number of emails.
mail_recent() {
    "$ROOT_DIR/bin/mail_recent" --limit "${argc_limit:-5}" >> "$LLM_OUTPUT"
}

# @cmd Search for emails in the inbox.
# @option --query! The search query.
# @option --limit <INT> The max results.
mail_search() {
    "$ROOT_DIR/bin/mail_search" --query "$argc_query" --limit "${argc_limit:-10}" >> "$LLM_OUTPUT"
}

# @cmd Read the body of a specific email.
# @option --subject! The email subject.
# @option --sender! The email sender.
mail_read() {
    "$ROOT_DIR/bin/mail_read" --subject "$argc_subject" --sender "$argc_sender" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
