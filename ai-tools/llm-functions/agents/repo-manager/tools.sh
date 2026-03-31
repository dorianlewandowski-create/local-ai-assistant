#!/usr/bin/env bash
set -e

# @cmd Create a GitHub issue.
# @option --title! Issue title.
# @option --body! Issue body.
# @option --label Issue label.
gh_issue() {
    "$ROOT_DIR/bin/gh_issue" --title "$argc_title" --body "$argc_body" --label "${argc_label:-}" >> "$LLM_OUTPUT"
}

# @cmd Get a summary of the repository status.
repo_summary() {
    "$ROOT_DIR/bin/repo_summary" >> "$LLM_OUTPUT"
}

# @cmd Automatically update the README.md.
auto_document() {
    "$ROOT_DIR/bin/auto_document" >> "$LLM_OUTPUT"
}

# @cmd Commit and push changes to GitHub.
# @option --message Use a specific commit message.
repo_push() {
    "$ROOT_DIR/bin/repo_push" --message "${argc_message:-}" >> "$LLM_OUTPUT"
}

# @cmd List files in the repo.
# @option --path! Path to list.
fs_ls() {
    "$ROOT_DIR/bin/fs_ls" --path "$argc_path" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
