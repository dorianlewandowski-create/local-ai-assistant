#!/usr/bin/env bash
set -e

# @describe Formally install a new AI-generated tool into the system.
# @option --name! The filename of the tool in the tools/ directory (e.g., "sys_check.sh").
# @option --description The tool description.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TOOLS_DIR="$ROOT_DIR/tools"
TOOLS_LIST="$ROOT_DIR/tools.txt"

main() {
    local tool_file="$TOOLS_DIR/$argc_name"
    
    if [[ ! -f "$tool_file" ]]; then
        echo "Error: Tool file not found at $tool_file" >> "$LLM_OUTPUT"
        return 1
    fi

    # 1. Ensure executable
    chmod +x "$tool_file"
    echo "Made $argc_name executable." >> "$LLM_OUTPUT"

    # 2. Register in tools.txt
    if ! grep -q "^$argc_name$" "$TOOLS_LIST"; then
        echo "$argc_name" >> "$TOOLS_LIST"
        echo "Registered $argc_name in tools.txt." >> "$LLM_OUTPUT"
    else
        echo "$argc_name already registered in tools.txt." >> "$LLM_OUTPUT"
    fi

    # 3. Build system
    echo "Rebuilding system to generate shims and declarations..." >> "$LLM_OUTPUT"
    (cd "$ROOT_DIR" && ./Argcfile.sh build) >> "$LLM_OUTPUT" 2>&1

    echo "Successfully installed skill: $argc_name" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
