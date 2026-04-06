#!/usr/bin/env bash
set -e

# @describe Render professional terminal UI components (panels, tables, markdown).
# @option --type! The component type: panel, table, md.
# @option --content! The content to render.
# @option --title The title for the component.
# @option --style The color/style for the component (default: blue).

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
RENDER_PY="$ROOT_DIR/utils/render.py"

main() {
    local title_arg=""
    if [[ -n "$argc_title" ]]; then
        title_arg="--title \"$argc_title\""
    fi

    # Execute the python renderer
    # We pipe to cat to ensure it handles the terminal output correctly in some wrappers
    python3 "$RENDER_PY" --type "$argc_type" --content "$argc_content" $title_arg --style "${argc_style:-blue}"
}

eval "$(argc --argc-eval "$0" "$@")"
