#!/usr/bin/env bash
set -e

# @describe Create a GitHub issue in the current repository.
# @option --title! The issue title.
# @option --body! The issue body.
# @option --label The issue label (optional).

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local label_arg=""
    if [[ -n "$argc_label" ]]; then
        label_arg="--label $argc_label"
    fi

    echo "Creating GitHub issue: $argc_title" >> "$LLM_OUTPUT"
    gh issue create --title "$argc_title" --body "$argc_body" $label_arg >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
