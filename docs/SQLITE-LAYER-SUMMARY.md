# 🧠 SQLITE Memory Layer Summary

The system uses a centralized SQLite database (`~/Notes/assistant.db`) as its "structured brain." This allows the LLM to maintain state across different sessions and agents.

## 📊 Core Tables

- **`projects`**: Stores project metadata (slug, status, owner, note_path).
- **`tasks`**: Tracks individual project tasks, status (open/done), and source references.
- **`decisions`**: Logs key project decisions with reasons and timestamps.
- **`research_topics` & `research_items`**: Manages deep research investigations and findings.
- **`meetings`**: Stores summaries and action items from recent syncs.

## 🔄 Synchronization

The database is kept in sync with human-readable Markdown notes via the `sync_projects_bidirectional` tool.
- **Markdown -> SQLite**: New bullets in `## Next steps` are indexed as tasks.
- **SQLite -> Markdown**: Tasks marked as `done` via CLI are updated to `[x]` in the note.
- **Timestamping**: Conflict resolution is handled via `updated_at` comparisons.
