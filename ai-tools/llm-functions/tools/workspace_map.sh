#!/usr/bin/env bash
set -e

# @describe Analyze a project directory to identify its structure, tech stack, and entry points.
# @option --dir-path! The root path of the project to map.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local dir_path="$argc_dir_path"
    if [[ ! -d "$dir_path" ]]; then
        echo "Error: Directory not found at $dir_path" >&2
        return 1
    fi

    echo "### Project Map for: $dir_path" >> "$LLM_OUTPUT"
    
    echo -e "\n**Directory Structure (max-depth 2):**" >> "$LLM_OUTPUT"
    find "$dir_path" -maxdepth 2 -not -path '*/.*' >> "$LLM_OUTPUT"

    echo -e "\n**High-Signal Files Identified:**" >> "$LLM_OUTPUT"
    local signals=("package.json" "Cargo.toml" "requirements.txt" "README.md" "GEMINI.md" ".env.example" "tsconfig.json" "go.mod")
    for file in "${signals[@]}"; do
        if [[ -f "$dir_path/$file" ]]; then
            echo "- $file (Found)" >> "$LLM_OUTPUT"
            if [[ "$file" == "package.json" || "$file" == "README.md" || "$file" == "GEMINI.md" ]]; then
                echo -e "\n**Content of $file (first 20 lines):**" >> "$LLM_OUTPUT"
                echo "---" >> "$LLM_OUTPUT"
                head -n 20 "$dir_path/$file" >> "$LLM_OUTPUT"
                echo "---" >> "$LLM_OUTPUT"
            fi
        fi
    done
}

eval "$(argc --argc-eval "$0" "$@")"
