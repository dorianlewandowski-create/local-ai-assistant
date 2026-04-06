#!/usr/bin/env bash
set -e

# @describe Log user feedback and corrections for future self-optimization.
# @option --agent-name! The name of the agent being corrected.
# @option --feedback! The user's correction or feedback text.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LEARNINGS_FILE="$(cd "$ROOT_DIR/../.." && pwd)/docs/LEARNINGS.md"

main() {
    mkdir -p "$(dirname "$LEARNINGS_FILE")"
    
    local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
    
    echo "Logging feedback for $argc_agent_name..." >> "$LLM_OUTPUT"
    
    {
        echo "### [$timestamp] Agent: $argc_agent_name"
        echo "- **User Feedback**: $argc_feedback"
        echo "---"
    } >> "$LEARNINGS_FILE"

    echo "Feedback recorded in LEARNINGS.md." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
