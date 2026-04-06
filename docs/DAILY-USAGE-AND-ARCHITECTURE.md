# 🏗️ Daily Usage and Architecture Guide

## 📐 System Architecture

The assistant follows a 4-layer architecture:

1.  **Orchestration Layer**: Shell aliases (`pa`, `wa`, `fm`) and the `aichat` role engine.
2.  **Specialist Agent Layer**: Specialized roles (`personal-assistant`, `workflow-agent`, `file-manager`, `coder`).
3.  **Action/Tool Layer**: Atomic scripts in `ai-tools/llm-functions/bin/` that perform real-world actions.
4.  **Memory Layer**: Hybrid SQLite (structured) + Markdown (narrative) persistence.

## 📅 Common Daily Workflows

### 🌅 The Morning Brief
Run `pa "morning breef"` to synthesize:
- **Calendar**: Today's meetings and events.
- **Reminders**: Overdue or upcoming tasks.
- **Inbox**: New ideas captured yesterday.
- **Projects**: The top 3 next steps from active projects.

### 🧹 Real-time File Organization
The `fm` agent is used for cleanup:
- `fm "Organize my Downloads"` -> Classifies files by type/project and moves them.
- `fm "Clean my Desktop"` -> Identifies screenshots and archives them to project assets.

### 🔬 Deep Research
Use `pa "deep research on [topic]"` for:
- Iterative web searching and fetching.
- Fact synthesis and follow-up query generation.
- Production of a final Markdown report in `~/Notes/research/`.
