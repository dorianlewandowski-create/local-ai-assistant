# 🐚 Shell vs. AIChat Workflows

The assistant is designed to be used both as a direct CLI helper and as an interactive conversational agent.

## 🛠️ Shell-Direct Workflows
Use these for quick, atomic actions:
- `taskdone "project" "task"`: Quickly close a task in the DB.
- `searchweb "query"`: Perform a quick web search.
- `mbrief`: Run the morning brief synthesis.

## 💬 AIChat (Agentic) Workflows
Use these for complex requests that require reasoning or tool orchestration:
- `pa "Sync my projects"`: Triggers the bidirectional sync.
- `fm "Clean my Downloads"`: Triggers file classification and movement.
- `wa "Find receipts in Mail and save to note"`: Executes a multi-step plan.

## 🔄 The Integration
The shell and AIChat layers share the same "Brain" (SQLite) and "Memory" (Markdown), meaning actions taken in the shell are immediately visible to the agents.
