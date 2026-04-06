#!/usr/bin/env bash
set -e

# @describe Stage changes, generate an AI commit message, and push to GitHub.
# @option --message Use a specific commit message instead of generating one.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"

main() {
    cd "$REPO_ROOT"
    
    echo "Staging all changes..." >> "$LLM_OUTPUT"
    git add .

    local commit_msg="$argc_message"
    if [[ -z "$commit_msg" ]]; then
        echo "Generating AI commit message (direct call)..." >> "$LLM_OUTPUT"
        local diff=$(git diff --cached --name-only | head -n 20) # Limit diff size
        if [[ -z "$diff" ]]; then
            echo "No changes to commit." >> "$LLM_OUTPUT"
            return 0
        fi
        
        # Use a simple prompt and call ollama directly via curl to avoid aichat nesting
        local prompt="Generate a 1-line git commit message for: $diff. Response must be ONLY the message."
        commit_msg=$(curl -s http://localhost:11434/api/generate -d "{
            \"model\": \"llama3.1:8b\",
            \"prompt\": \"$prompt\",
            \"stream\": false
        }" | jq -r '.response' | tr -d '"' | xargs)
        
        # Fallback if LLM fails
        if [[ -z "$commit_msg" ]]; then
            commit_msg="Update Local AI Assistant: $(date +'%Y-%m-%d')"
        fi
    fi

    echo "Commit message: $commit_msg" >> "$LLM_OUTPUT"
    
    # We removed the local guard_operation call to let aichat's native 
    # confirmation handling manage the process safely.

    git commit -m "$commit_msg"
    git push
    
    echo "Successfully pushed to GitHub." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
