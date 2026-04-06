#!/usr/bin/env bash
set -e

# @describe Automatically update the README.md based on current tools and agents.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"

main() {
    echo "Scanning tools and agents for documentation..." >> "$LLM_OUTPUT"
    
    local tools=$(ls -1 "$ROOT_DIR/tools" | grep '\.sh' | sed 's/\.sh//g' | tr '\n' ',' | sed 's/,$//')
    local agents=$(cat "$ROOT_DIR/agents.txt" | tr '\n' ',' | sed 's/,$//')
    
    local current_readme=$(cat "$REPO_ROOT/README.md")
    
    local prompt="You are a technical writer. Update the following README content to include all these new tools and agents in the 'Key Features' or 'Tool Registry' section. 
    
    Current Tools: $tools (These are shell scripts, do not append .py or other extensions)
    Current Agents: $agents
    
    Current README Content:
    $current_readme
    
    Return the FULL updated README.md content. Do not return any other text. 
    Maintain the existing structure but ensure the tool list is complete and accurate."

    local updated_readme
    updated_readme=$(aichat -m ollama:llama3.1:8b "$prompt")
    
    echo "$updated_readme" > "$REPO_ROOT/README.md"
    echo "README.md has been updated with $tools and $agents." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
