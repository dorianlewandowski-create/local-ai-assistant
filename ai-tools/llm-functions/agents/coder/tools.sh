# @cmd Analyze a project directory to identify its structure, tech stack, and entry points.
# @option --dir-path! The root path.
workspace_map() {
    "$ROOT_DIR/bin/workspace_map" --dir-path "$argc_dir_path" >> "$LLM_OUTPUT"
}

# @cmd Autonomous debugging loop: Run a command, capture error, fix code, and repeat.
# @option --test-command! The command to execute.
# @option --max-iterations Maximum attempts.
autonomous_fix() {
    "$ROOT_DIR/bin/autonomous_fix" --test-command "$argc_test_command" --max-iterations "${argc_max_iterations:-3}" >> "$LLM_OUTPUT"
}

# @cmd List all files and directories at the specified path.
# @option --path! The path.
fs_ls() {
    "$ROOT_DIR/bin/fs_ls" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Cat the contents of a file at the specified path.
# @option --path! The path.
fs_cat() {
    "$ROOT_DIR/bin/fs_cat" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Apply a patch to a file.
# @option --path! The path.
# @option --contents! The patch.
fs_patch() {
    "$ROOT_DIR/bin/fs_patch" --path "$argc_path" --contents "$argc_contents" >> "$LLM_OUTPUT"
}

# @cmd Create a new directory.
# @option --path! The path.
fs_mkdir() {
    "$ROOT_DIR/bin/fs_mkdir" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Write file contents.
# @option --path! The path.
# @option --contents! The contents.
fs_write() {
    "$ROOT_DIR/bin/fs_write" --path "$argc_path" --contents "$argc_contents" >> "$LLM_OUTPUT"
}

# @cmd Remove file/dir.
# @option --path! The path.
fs_rm() {
    "$ROOT_DIR/bin/fs_rm" --path "$argc_path" >> "$LLM_OUTPUT"
}

# @cmd Move/Rename file/dir.
# @option --source! The source.
# @option --destination! The destination.
fs_mv() {
    "$ROOT_DIR/bin/fs_mv" --source "$argc_source" --destination "$argc_destination" >> "$LLM_OUTPUT"
}

# @cmd Copy file/dir.
# @option --source! The source.
# @option --destination! The destination.
fs_cp() {
    "$ROOT_DIR/bin/fs_cp" --source "$argc_source" --destination "$argc_destination" >> "$LLM_OUTPUT"
}

# @cmd Consult another specialist agent for an opinion or information.
# @option --agent-name! The name of the agent to consult (pa, wa, fm, coder).
# @option --query! The specific question or task for the specialist.
consult_agent() {
    "$ROOT_DIR/bin/consult_agent" --agent-name "$argc_agent_name" --query "$argc_query" >> "$LLM_OUTPUT"
}

# @cmd Formally install a new AI-generated tool into the system.
# @option --name! The filename.
# @option --description The tool description.
skill_install() {
    "$ROOT_DIR/bin/skill_install" --name "$argc_name" --description "${argc_description:-}" >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
