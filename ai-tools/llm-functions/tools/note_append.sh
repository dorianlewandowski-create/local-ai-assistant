#!/usr/bin/env bash
set -euo pipefail

file_arg="${1:-}"
text="${2:-}"
notes_dir="${3:-$HOME/Notes}"
root_dir="${4:-}"

if [[ -z "$file_arg" || -z "$text" ]]; then
    echo "Usage: note_append.sh <file> <text> [notes_dir] [root_dir]" >&2
    exit 1
fi

if [[ "$file_arg" = /* ]]; then
    target_file="$file_arg"
else
    target_file="$notes_dir/$file_arg"
fi

mkdir -p "$(dirname "$target_file")"

if [[ -n "$root_dir" ]]; then
    "$root_dir/utils/guard_operation.sh" "Append note to '$target_file'?"
fi

timestamp="$(date '+%Y-%m-%d %H:%M')"
printf '\n- [%s] %s\n' "$timestamp" "$text" >> "$target_file"
printf 'Appended note to: %s\n' "$target_file"
