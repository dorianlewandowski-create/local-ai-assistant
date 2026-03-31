#!/usr/bin/env bash
set -e

# @describe Classify a list of files to suggest target directories and descriptive names.

# @option --files! Comma-separated list of filenames or paths.
# @option --context-dirs Comma-separated list of potential target directories.

# @env LLM_OUTPUT=/dev/stdout The output path

main() {
    local files="$argc_files"
    local context_dirs="${argc_context_dirs:-Documents,Pictures,Desktop,Downloads,Projects}"
    
    # Get current projects from the SQLite DB for better context
    local db_path="$HOME/Notes/assistant.db"
    local project_slugs=""
    if [[ -f "$db_path" ]]; then
        project_slugs=$(sqlite3 "$db_path" "SELECT slug FROM projects WHERE status = 'active';")
    fi

    local prompt="You are a file organization expert. Classify these files and suggest a destination directory and a descriptive filename.
    
    Files to classify:
    $files
    
    Potential general categories: $context_dirs
    Active project slugs (prefer these if relevant):
    $project_slugs
    
    Return ONLY a JSON array of objects with these keys:
    'file' (original name),
    'type' (e.g. image, document, code),
    'topic' (e.g. invoice, screenshot, project-x),
    'suggested_name' (descriptive filename with original extension),
    'suggested_dir' (the target directory path relative to HOME, e.g. 'Documents/Invoices' or 'Notes/projects/assets/slug').
    
    If a file belongs to a project, suggest 'Notes/projects/assets/[slug]'.
    Do not return any other text."

    local result
    result=$(aichat -m ollama:llama3.1:8b "$prompt")
    
    # Extract JSON
    echo "$result" | sed -n '/\[/,/\]/p' >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
