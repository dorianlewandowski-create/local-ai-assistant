#!/usr/bin/env bash
set -e

# @describe Use vision analysis to categorize and organize a file into project or research assets.

# @option --file-path! The path of the image file to organize.
# @option --target-type The explicit target type (project or research).

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    local file_path="$argc_file_path"
    if [[ ! -f "$file_path" ]]; then
        echo "Error: File not found at $file_path" >&2
        return 1
    fi

    echo "Analyzing '$file_path' with vision..." >> "$LLM_OUTPUT"

    # Call vision-assistant to categorize and suggest a name
    local analysis prompt
    prompt="Analyze this image. Determine if it belongs to a 'project' or 'research' topic.
    Return ONLY a JSON object with these keys: 
    'category' (string: project or research), 
    'target_name' (string: the most likely project slug or research topic slug), 
    'suggested_filename' (string: a descriptive filename ending in the original extension),
    'reason' (string: short explanation).
    Do not return any other text."

    analysis=$(aichat --agent vision-assistant -f "$file_path" "$prompt")

    # Extract JSON from the analysis result (cleaning up potential markdown blocks)
    local json_result
    json_result=$(echo "$analysis" | sed -n '/{/,/}/p' | jq -c '.')

    python3 - <<'PY' "$file_path" "$json_result" "$ROOT_DIR"
import sys
import json
import os
import shutil
from pathlib import Path
import subprocess

file_path = Path(sys.argv[1])
result = json.loads(sys.argv[2])
root_dir = Path(sys.argv[3])

category = result.get('category', 'project')
target_name = result.get('target_name', 'misc')
suggested_filename = result.get('suggested_filename', file_path.name)
reason = result.get('reason', 'Categorized by vision assistant.')

# Resolve base assets directory
notes_dir = Path.home() / 'Notes'
if category == 'project':
    base_dir = notes_dir / 'projects' / 'assets'
else:
    base_dir = notes_dir / 'research' / 'assets'

target_dir = base_dir / target_name
target_dir.mkdir(parents=True, exist_ok=True)

final_path = target_dir / suggested_filename

print(f"Moving to: {final_path} (Reason: {reason})")

# Perform move
shutil.move(str(file_path), str(final_path))

# Update project/research note if it exists
note_search_script = root_dir / 'agents/personal-assistant/note_append.sh'
if note_search_script.exists():
    note_name = f"{category}s/{target_name}.md" if category == 'project' else f"research/{target_name}.md"
    note_file = notes_dir / note_name
    if note_file.exists():
        append_text = f"## Assets\n\n- Image: {suggested_filename} | Path: {final_path}\n- Reason: {reason}\n"
        subprocess.run(['bash', str(note_search_script), str(note_name), append_text, str(notes_dir), str(root_dir)], capture_output=True)

PY
    echo "Vision-enhanced organization completed." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
