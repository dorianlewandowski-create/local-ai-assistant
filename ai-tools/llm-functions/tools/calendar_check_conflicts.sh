#!/usr/bin/env bash
set -e

# @describe Check for calendar conflicts within a given time range.

# @option --start! The start date and time.
# @option --end! The end date and time.
# @option --calendar-name The optional calendar name.

# @env LLM_OUTPUT=/dev/stdout The output path

AGENT_DIR="${LLM_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../agents/personal-assistant" && pwd)}"
ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    local start_dt end_dt events
    start_dt="$(python3 "$ROOT_DIR/utils/parse_natural_datetime.py" "$argc_start")"
    end_dt="$(python3 "$ROOT_DIR/utils/parse_natural_datetime.py" "$argc_end")"
    
    # List events for that day
    events=$(osascript "$AGENT_DIR/calendar_list_events.applescript" "$start_dt" 1 "${argc_calendar_name:-}")
    
    if [[ "$events" == "No events found." ]]; then
        echo "No conflicts found." >> "$LLM_OUTPUT"
        return 0
    fi

    echo "Conflicts found:" >> "$LLM_OUTPUT"
    echo "$events" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
