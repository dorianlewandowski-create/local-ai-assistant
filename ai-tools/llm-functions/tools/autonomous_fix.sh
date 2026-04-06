#!/usr/bin/env bash
set -e

# @describe Autonomous debugging loop: Run a command, capture error, fix code, and repeat.
# @option --test-command! The command to execute (e.g., "npm test" or "python script.py").
# @option --max-iterations <INT> Maximum number of fix attempts (default 3).

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    local cmd="$argc_test_command"
    local max_iters="${argc_max_iterations:-3}"
    local iter=1
    local output exit_code

    echo "### Starting Autonomous Fix Loop: $cmd" >> "$LLM_OUTPUT"

    while [[ $iter -le $max_iters ]]; do
        echo -e "\n--- Iteration $iter/$max_iters ---" >> "$LLM_OUTPUT"
        
        # 1. Run command and capture output/exit_code
        set +e
        output=$(eval "$cmd" 2>&1)
        exit_code=$?
        set -e

        if [[ $exit_code -eq 0 ]]; then
            echo "[SUCCESS] Command passed." >> "$LLM_OUTPUT"
            echo "Output:" >> "$LLM_OUTPUT"
            echo "---" >> "$LLM_OUTPUT"
            echo "$output" >> "$LLM_OUTPUT"
            echo "---" >> "$LLM_OUTPUT"
            return 0
        else
            echo "[FAILURE] Command failed with exit code $exit_code." >> "$LLM_OUTPUT"
            echo "Output excerpt:" >> "$LLM_OUTPUT"
            echo "---" >> "$LLM_OUTPUT"
            echo "$output" | tail -n 25 >> "$LLM_OUTPUT"
            echo "---" >> "$LLM_OUTPUT"

            # 2. Ask the Coder agent to analyze and fix
            echo "Analyzing error and applying fix..." >> "$LLM_OUTPUT"
            
            local prompt="The command '$cmd' failed with the following output:
            
            $output
            
            Please analyze the error, identify the relevant files, and apply a fix using the available tools (fs_cat, fs_patch, etc.). 
            Once you have applied a fix, let me know which files you modified."

            # We use aichat to call the coder agent
            local fix_summary
            fix_summary=$(aichat --agent coder "$prompt")
            
            echo "Coder fix summary:" >> "$LLM_OUTPUT"
            echo "$fix_summary" >> "$LLM_OUTPUT"
        fi

        ((iter++))
    done

    echo "[FAILED] Maximum iterations reached without success." >> "$LLM_OUTPUT"
    return 1
}

eval "$(argc --argc-eval "$0" "$@")"
