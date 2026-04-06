#!/usr/bin/env bash
set -e

# @describe Copy a file or directory.

# @option --source! The source path of the file or directory.
# @option --destination! The target destination path.
# @option --recursive Boolean to indicate recursive copy for directories.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    "$ROOT_DIR/utils/guard_security.sh" "$argc_source" "cp_source"
    "$ROOT_DIR/utils/guard_security.sh" "$argc_destination" "cp_dest"
    
    local cp_args=""
    if [[ -n "$argc_recursive" && "$argc_recursive" == "true" ]]; then
        cp_args="-r"
    fi

    # Ensure parent directory of destination exists
    mkdir -p "$(dirname "$argc_destination")"

    cp $cp_args "$argc_source" "$argc_destination"
    echo "Copied '$argc_source' to '$argc_destination'" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
