#!/usr/bin/env bash
set -e

# @cmd List files in a directory.
# @option --path! The directory path.
file_list() {
    "$ROOT_DIR/bin/fs_ls" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Find files by pattern or extension.
# @option --dir! The directory.
# @option --name A name pattern.
# @option --ext Extensions.
file_find() {
    "$ROOT_DIR/bin/file_find" --dir "$argc_dir" --name "${argc_name:-}" --ext "${argc_ext:-}" >> "$LLM_OUTPUT"
}

# @cmd Move a file or directory.
# @option --source! The source.
# @option --destination! The destination.
file_move() {
    "$ROOT_DIR/bin/fs_mv" --source "$argc_source" --destination "$argc_destination" >> "$LLM_OUTPUT"
}

# @cmd Rename a file or directory.
# @option --source! The source.
# @option --destination! The new name/path.
file_rename() {
    "$ROOT_DIR/bin/fs_mv" --source "$argc_source" --destination "$argc_destination" >> "$LLM_OUTPUT"
}

# @cmd Delete a file or directory.
# @option --path! The path to delete.
file_delete() {
    "$ROOT_DIR/bin/fs_rm" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Classify files for organization.
# @option --files! Comma-separated list of files.
file_classify() {
    "$ROOT_DIR/bin/file_classify" --files "$argc_files" >> "$LLM_OUTPUT"
}

# @cmd Create a directory.
# @option --path! The path.
fs_mkdir() {
    "$ROOT_DIR/bin/fs_mkdir" --path "$argc_path" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
