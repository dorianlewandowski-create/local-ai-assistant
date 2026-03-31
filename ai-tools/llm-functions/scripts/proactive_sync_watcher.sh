#!/usr/bin/env bash

# Proactive Sync Watcher: Uses fswatch to monitor project notes and trigger bidirectional sync.

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

WATCH_DIR="$HOME/Notes/projects"
# Call the source script directly to avoid JSON wrapper issues in background
SYNC_SCRIPT="$HOME/ai-tools/llm-functions/tools/sync_projects_bidirectional.sh"
LOG_FILE="$HOME/Library/Logs/ai_assistant_sync.log"

mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date)] Sync watcher (re)started for $WATCH_DIR" >> "$LOG_FILE"

# Monitor the directory for any .md file changes
# Debounce: xargs -n 1 -I {} will trigger for each event, but we use a short sleep to handle multiple events from editors
/opt/homebrew/bin/fswatch -o "$WATCH_DIR" --event Updated --event Created --event Removed | while read -r event; do
    echo "[$(date)] File change detected. Triggering sync..." >> "$LOG_FILE"
    
    # Run the script directly with required env
    LLM_ROOT_DIR="$HOME/ai-tools/llm-functions" bash "$SYNC_SCRIPT" >> "$LOG_FILE" 2>&1
    
    echo "[$(date)] Sync completed." >> "$LOG_FILE"
    
    # Short sleep to debounce rapid saves from editors like VS Code or Obsidian
    sleep 2
done
