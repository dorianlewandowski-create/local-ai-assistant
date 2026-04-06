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

# @cmd Autonomously optimize agent instructions based on collected user feedback.
optimize_instructions() {
    "$ROOT_DIR/bin/optimize_instructions" >> "$LLM_OUTPUT"
}

# @cmd Commit and push changes to GitHub.
# @option --message Use a specific commit message.
repo_push() {
    "$ROOT_DIR/bin/repo_push" --message "${argc_message:-}" >> "$LLM_OUTPUT"
}

# @cmd Consult another specialist agent for an opinion or information.
# @option --agent-name! The name of the agent to consult (pa, wa, fm, coder).
# @option --query! The specific question or task for the specialist.
consult_agent() {
    "$ROOT_DIR/bin/consult_agent" --agent-name "$argc_agent_name" --query "$argc_query" >> "$LLM_OUTPUT"
}

# @cmd List files in the repo.
# @option --path! Path to list.
fs_ls() {
    "$ROOT_DIR/bin/fs_ls" --path "$argc_path" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
