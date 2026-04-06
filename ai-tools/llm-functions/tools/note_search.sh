#!/usr/bin/env bash
set -euo pipefail

query="${1:-}"
notes_dir="${2:-$HOME/Notes}"

if [[ -z "$query" ]]; then
    echo "Missing query" >&2
    exit 1
fi

if [[ ! -d "$notes_dir" ]]; then
    echo "Notes directory not found: $notes_dir"
    exit 0
fi

echo "Searching notes in: $notes_dir"
if ! rg -n -i --context 1 --max-count 20 "$query" "$notes_dir"; then
    echo "No note matches found."
fi
