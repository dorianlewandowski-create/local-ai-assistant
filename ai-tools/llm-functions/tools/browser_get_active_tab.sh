#!/usr/bin/env bash
set -e

# @describe Get the URL and title of the active tab in Safari or Chrome.
# @option --browser <STRING> The browser to check (safari or chrome). Defaults to safari.

# @env LLM_OUTPUT=/dev/stdout The output path

AGENT_DIR="${LLM_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../agents/personal-assistant" && pwd)}"

main() {
    local browser="${argc_browser:-safari}"
    local result
    
    if [[ "$browser" == "safari" ]]; then
        result=$(osascript "$AGENT_DIR/browser_safari_active_tab.applescript")
    elif [[ "$browser" == "chrome" ]]; then
        result=$(osascript "$AGENT_DIR/browser_chrome_active_tab.applescript")
    else
        echo "Error: Unsupported browser '$browser'." >&2
        return 1
    fi
    
    echo "$result" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
