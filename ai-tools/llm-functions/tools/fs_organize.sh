#!/usr/bin/env bash
set -e

# @describe Organize files by moving them into target directories based on patterns or extensions.

# @option --source-dir! The source directory containing files to organize.
# @option --target-dir! The target directory to move files to.
# @option --pattern Search pattern like "*.pdf" or "screenshot*".
# @option --extensions Comma-separated list of extensions (e.g., "jpg,png,gif").

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    "$ROOT_DIR/utils/guard_path.sh" "$argc_source_dir" "Organize files from '$argc_source_dir'?"
    "$ROOT_DIR/utils/guard_path.sh" "$argc_target_dir" "Organize files into '$argc_target_dir'?"
    
    mkdir -p "$argc_target_dir"

    local moved_count=0
    
    # Using find to identify files
    local find_cmd=(find "$argc_source_dir" -maxdepth 1 -type f)
    
    if [[ -n "$argc_pattern" ]]; then
        find_cmd+=(-name "$argc_pattern")
    elif [[ -n "$argc_extensions" ]]; then
        IFS=',' read -ra ADDR <<< "$argc_extensions"
        local or_args=()
        for ext in "${ADDR[@]}"; do
            or_args+=(-name "*.$ext" -o)
        done
        unset 'or_args[${#or_args[@]}-1]' # Remove last -o
        find_cmd+=(\( "${or_args[@]}" \))
    fi

    # Execute move
    while IFS= read -r file; do
        if [[ -f "$file" ]]; then
            mv "$file" "$argc_target_dir/"
            ((moved_count++))
        fi
    done < <("${find_cmd[@]}")

    echo "Organized $moved_count files from '$argc_source_dir' to '$argc_target_dir'" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
