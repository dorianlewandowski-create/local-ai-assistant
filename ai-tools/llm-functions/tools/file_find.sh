#!/usr/bin/env bash
set -e

# @describe Find files by name pattern or extension.

# @option --dir! The directory to search in.
# @option --name A name pattern (e.g., "*config*").
# @option --ext Comma-separated list of extensions (e.g., "pdf,jpg").

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local find_cmd=(find "$argc_dir" -maxdepth 2)
    
    if [[ -n "$argc_name" ]]; then
        find_cmd+=(-name "$argc_name")
    fi
    
    if [[ -n "$argc_ext" ]]; then
        IFS=',' read -ra ADDR <<< "$argc_ext"
        local or_args=()
        for ext in "${ADDR[@]}"; do
            or_args+=(-name "*.$ext" -o)
        done
        unset 'or_args[${#or_args[@]}-1]' # Remove last -o
        find_cmd+=(\( "${or_args[@]}" \))
    fi

    echo "### Search results in $argc_dir:" >> "$LLM_OUTPUT"
    "${find_cmd[@]}" -not -path '*/.*' >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
