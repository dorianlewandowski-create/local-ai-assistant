#!/usr/bin/env bash
set -e

# @describe Get a summary of recent commits and open GitHub issues.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    echo "### Recent Commits (Last 10):" >> "$LLM_OUTPUT"
    git log -n 10 --pretty=format:"%h %s (%cr)" >> "$LLM_OUTPUT" || echo "Not a git repo or no commits yet." >> "$LLM_OUTPUT"
    
    echo -e "\n\n### Open GitHub Issues:" >> "$LLM_OUTPUT"
    gh issue list --limit 10 >> "$LLM_OUTPUT" || echo "Could not fetch issues (check gh auth)." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
