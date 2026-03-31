#!/usr/bin/env bash
set -e

# @describe Move or rename a file or directory.

# @option --source! The source path of the file or directory.
# @option --destination! The target destination path.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    "$ROOT_DIR/utils/guard_path.sh" "$argc_source" "Move/Rename source '$argc_source'?"
    "$ROOT_DIR/utils/guard_path.sh" "$argc_path" "Move/Rename to destination '$argc_destination'?"
    
    # Check if target directory exists if moving into a directory
    if [[ -d "$argc_destination" ]]; then
        mkdir -p "$argc_destination"
    else
        mkdir -p "$(dirname "$argc_destination")"
    fi

    mv "$argc_source" "$argc_destination"
    echo "Moved '$argc_source' to '$argc_destination'" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
