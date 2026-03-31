#!/usr/bin/env bash
set -e

# @describe Delegate a complex, multi-step request to the Workflow Agent.
# @option --request! The full request string to delegate.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    echo "Delegating complex request to Workflow Agent: $argc_request" >> "$LLM_OUTPUT"
    # Execute the workflow-agent via its built binary
    "$(dirname "$0")/workflow-agent" run "$argc_request" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
