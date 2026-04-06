#!/usr/bin/env bash
set -e

# @describe Check if the active browser tab relates to any active project.
# @option --browser <STRING> The browser to check (safari or chrome). Defaults to safari.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN_DIR="$ROOT_DIR/bin"

main() {
    local browser="${argc_browser:-safari}"
    
    echo "Getting active tab from $browser..." >> "$LLM_OUTPUT"
    local tab_info=$("$BIN_DIR/browser_get_active_tab" --browser "$browser")
    
    if [[ "$tab_info" == *"not running"* ]]; then
        echo "Error: $tab_info" >> "$LLM_OUTPUT"
        return 1
    fi

    local title=$(echo "$tab_info" | awk -F ' | ' '{print $1}')
    local url=$(echo "$tab_info" | awk -F ' | ' '{print $NF}')

    echo "Fetching page content: $url" >> "$LLM_OUTPUT"
    local content=$("$BIN_DIR/fetch_url_via_curl" --url "$url" | head -n 50) # Just get the top for matching

    echo "Querying active projects..." >> "$LLM_OUTPUT"
    local projects=$(sqlite3 ~/Notes/assistant.db "SELECT slug, title FROM projects WHERE status = 'active';")

    echo "Analyzing relationship..." >> "$LLM_OUTPUT"

    python3 - <<'PY' "$title" "$url" "$content" "$projects"
import sys
import json
import subprocess

title, url, content, projects_raw = sys.argv[1:5]

projects = []
for line in projects_raw.splitlines():
    if '|' in line:
        slug, p_title = line.split('|')
        projects.append({"slug": slug, "title": p_title})

prompt = f"""
You are a context linker. Determine if this web page relates to any of these active projects.

Web Page:
Title: {title}
URL: {url}
Snippet: {content}

Active Projects:
{json.dumps(projects, indent=2)}

Return ONLY a JSON object:
{{
  "match_found": true/false,
  "project_slug": "slug or null",
  "reasoning": "Short explanation of why it matches or why it does not",
  "suggested_action": "e.g. Save summary to [slug] research section"
}}
"""

proc = subprocess.run(['aichat', '-m', 'ollama:llama3.1:8b', prompt], capture_output=True, text=True)
print(proc.stdout.strip())
PY
}

eval "$(argc --argc-eval "$0" "$@")"
