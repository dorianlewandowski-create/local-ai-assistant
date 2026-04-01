#!/usr/bin/env bash
set -e

# @describe List all files and directories at the specified path.

# @option --path! The path of the directory to list

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    "$ROOT_DIR/utils/guard_security.sh" "$argc_path" "ls"
    ls -1 "$argc_path" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
