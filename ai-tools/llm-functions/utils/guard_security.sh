#!/usr/bin/env bash

# Local AI Assistant Gatekeeper: Validates actions against PERMISSIONS.yaml and logs activity.

UTILS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="$UTILS_DIR/PERMISSIONS.yaml"
# Correct path for local-ai-assistant structure
AUDIT_LOG="$(cd "$UTILS_DIR/../../../.." && pwd)/local-ai-assistant/docs/SECURITY_AUDIT.log"

# Function to resolve a path to its absolute realpath
get_realpath() {
    local path="$1"
    if [[ "$path" == "~"* ]]; then
        path="${path/#\~/$HOME}"
    fi
    # Use python to resolve path safely
    python3 -c "import os; print(os.path.realpath('$path'))"
}

main() {
    local target_path_raw="$1"
    local action="${2:-"read"}"
    local agent="${LLM_AGENT_NAME:-"unknown"}"
    
    local target_path=$(get_realpath "$target_path_raw")
    local timestamp=$(date +'%Y-%m-%d %H:%M:%S')

    # 1. Check Denied Paths
    # We use python for robust glob and path matching
    local is_denied=$(python3 - <<'PY' "$target_path" "$POLICY_FILE"
import sys
import yaml
from pathlib import Path

target = Path(sys.argv[1])
with open(sys.argv[2], 'r') as f:
    policy = yaml.safe_load(f)

denied = policy.get('denied_paths', [])
for pattern in denied:
    pattern_path = Path(pattern).expanduser()
    if target.is_relative_to(pattern_path) or str(target) == str(pattern_path):
        print("true")
        sys.exit(0)
    # Basic glob support
    if "**" in pattern:
        if pattern.split("**/")[1] in str(target):
            print("true")
            sys.exit(0)
print("false")
PY
)

    if [[ "$is_denied" == "true" ]]; then
        echo "[$timestamp] SECURITY VIOLATION: Agent '$agent' blocked from '$action' on '$target_path'" >> "$AUDIT_LOG"
        echo "Error: Security Violation. Access to '$target_path_raw' is strictly forbidden by system policy." >&2
        exit 1
    fi

    # 2. Log successful access
    echo "[$timestamp] ALLOWED: Agent '$agent' performed '$action' on '$target_path'" >> "$AUDIT_LOG"
}

main "$@"
