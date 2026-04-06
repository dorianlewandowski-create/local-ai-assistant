#!/usr/bin/env bash
set -e

# @describe Autonomously optimize agent instructions based on collected user feedback.

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
LEARNINGS_FILE="$REPO_ROOT/docs/LEARNINGS.md"
ROLES_DIR="/Users/dorianlewandowski/Library/Application Support/aichat/roles"

main() {
    if [[ ! -f "$LEARNINGS_FILE" ]]; then
        echo "No learnings found to optimize." >> "$LLM_OUTPUT"
        return 0
    fi

    echo "Analyzing collected feedback for optimization..." >> "$LLM_OUTPUT"

    python3 - <<'PY' "$LEARNINGS_FILE" "$ROLES_DIR"
import sys
import os
import subprocess
from pathlib import Path

learnings_path = Path(sys.argv[1])
roles_dir = Path(sys.argv[2])

if not learnings_path.exists():
    sys.exit(0)

content = learnings_path.read_text()
# Simple split by agent headers
sections = content.split('### ')
feedback_by_agent = {}

for section in sections:
    if not section.strip(): continue
    lines = section.splitlines()
    header = lines[0] # e.g. [2026-03-31 12:00:00] Agent: personal-assistant
    if 'Agent: ' in header:
        agent_name = header.split('Agent: ')[1].strip()
        feedback = '\n'.join(lines[1:])
        if agent_name not in feedback_by_agent:
            feedback_by_agent[agent_name] = []
        feedback_by_agent[agent_name].append(feedback)

for agent, feedbacks in feedback_by_agent.items():
    role_file = roles_dir / f"{agent}.md"
    if not role_file.exists():
        print(f"Skipping {agent}: Role file not found at {role_file}")
        continue

    print(f"Optimizing {agent} instructions...")
    current_instructions = role_file.read_text()
    all_feedback = "\n".join(feedbacks)

    prompt = f"""
    You are an AI System Architect. Your goal is to improve an AI agent's system instructions based on direct user feedback and corrections.

    CURRENT INSTRUCTIONS:
    ---
    {current_instructions}
    ---

    USER FEEDBACK & CORRECTIONS:
    ---
    {all_feedback}
    ---

    TASK:
    1. Analyze the feedback to identify failures in the current instructions.
    2. Rewrite the FULL role content (including frontmatter and headings).
    3. Ensure the new instructions solve the user's complaints while PRESERVING all previous rules and capabilities.
    4. Keep the structure clean and professional.

    Return ONLY the new FULL role content. Do not return any other text.
    """

    # Use aichat to generate the optimized role
    proc = subprocess.run(['aichat', '-m', 'ollama:llama3.1:8b', prompt], capture_output=True, text=True)
    if proc.returncode == 0 and proc.stdout.strip():
        role_file.write_text(proc.stdout.strip())
        print(f"Successfully optimized {agent} instructions.")
    else:
        print(f"Failed to optimize {agent}: {proc.stderr}")

PY

    # Archive the learnings
    mv "$LEARNINGS_FILE" "${LEARNINGS_FILE}.archived-$(date +%s)"
    echo "Optimization complete. Role instructions updated." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
