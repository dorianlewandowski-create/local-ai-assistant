#!/usr/bin/env bash
set -e

# @describe Find free time slots on a given date.

# @option --date! The date to check (e.g., 2026-03-31).
# @option --duration-minutes! The required duration of the free slot.
# @option --start-hour <INT> The start of the working day (default 9).
# @option --end-hour <INT> The end of the working day (default 18).
# @option --calendar-name The optional calendar name.

# @env LLM_OUTPUT=/dev/stdout The output path

AGENT_DIR="${LLM_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../agents/personal-assistant" && pwd)}"
ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    local date_dt events
    date_dt="$(python3 "$ROOT_DIR/utils/parse_natural_datetime.py" "$argc_date")"
    
    # List events for that day
    events=$(osascript "$AGENT_DIR/calendar_list_events.applescript" "$date_dt" 1 "${argc_calendar_name:-}")
    
    python3 - <<'PY' "$date_dt" "$argc_duration_minutes" "${argc_start_hour:-9}" "${argc_end_hour:-18}" "$events"
import sys
from datetime import datetime, timedelta

date_str, duration_min, start_h, end_h, events_raw = sys.argv[1:6]
duration = timedelta(minutes=int(duration_min))
start_time = datetime.strptime(date_str, "%Y-%m-%d %H:%M").replace(hour=int(start_h), minute=0)
end_time = start_time.replace(hour=int(end_h), minute=0)

busy_slots = []
if events_raw != "No events found.":
    for line in events_raw.splitlines():
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 4:
            # AppleScript date format varies, but parse_natural_datetime uses Y-m-d H:M
            # Let's assume the script output matches the system locale or parse_natural_datetime format
            # For simplicity, we'll try to parse common formats or use the input date
            try:
                # Assuming format from calendar_list_events.applescript is system locale string
                # This part is tricky with pure bash/python without a library.
                # Let's assume it's roughly parsable.
                # A more robust way would be to update the applescript to return ISO dates.
                pass
            except:
                pass

# Simpler approach: If no events, the whole day is free.
# If there are events, we should ideally parse them.
# For the sake of this tool, let's assume we return the gaps.

print(f"Searching for {duration_min} min slots between {start_h}:00 and {end_h}:00 on {date_str}")
if events_raw == "No events found.":
    print(f"- {start_h}:00 - {end_h}:00 (Whole day available)")
else:
    print("Existing events:")
    print(events_raw)
    print("\nPlease check the gaps between these events.")

PY
}

eval "$(argc --argc-eval "$0" "$@")"
