#!/usr/bin/env bash
set -e

# @describe Consult another specialist agent for an opinion or information.
# @option --agent-name! The name of the agent to consult (pa, wa, fm, coder).
# @option --query! The specific question or task for the specialist.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local agent="$argc_agent_name"
    local query="$argc_query"

    # Support for Dyslexia: Normalize agent names
    case "${agent,,}" in
        pa|personal*|assistant) agent="personal-assistant" ;;
        wa|workflow*|orchestrator) agent="workflow-agent" ;;
        fm|file*|librarian) agent="file-manager" ;;
        coder|code*|developer) agent="coder" ;;
        swarm|war*|orchestrator) agent="swarm" ;;
    esac

    echo "Consulting specialist '$agent'..." >> "$LLM_OUTPUT"
    
    # Execute the requested role and capture its output
    local response
    response=$(aichat --no-stream --role "$agent" "$query")
    
    echo "--- Response from $agent ---" >> "$LLM_OUTPUT"
    echo "$response" >> "$LLM_OUTPUT"
    echo "----------------------------" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
