#!/usr/bin/env bash
set -e

# @describe Sync project notes in Markdown to the SQLite assistant database.

# @option --notes-dir The root notes directory (default ~/Notes).

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

db_path() {
    printf '%s\n' "$HOME/Notes/assistant.db"
}

main() {
    local notes_dir="${argc_notes_dir:-$HOME/Notes}"
    local projects_dir="$notes_dir/projects"
    
    if [[ ! -d "$projects_dir" ]]; then
        echo "Error: Projects directory not found at $projects_dir" >&2
        return 1
    fi

    echo "Syncing project notes from $projects_dir to SQLite..." >> "$LLM_OUTPUT"

    python3 - <<'PY' "$(db_path)" "$projects_dir"
import sqlite3
import os
import re
from pathlib import Path

db_path, projects_dir = sys.argv[1:3]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

def parse_project_file(path):
    content = path.read_text(encoding='utf-8', errors='ignore')
    slug = path.stem
    title = slug.replace('-', ' ').title()
    status = 'active'
    owner = ''
    
    # Metadata extraction
    title_match = re.search(r'^#\s+(.+)$', content, re.M)
    if title_match: title = title_match.group(1).strip()
    
    slug_match = re.search(r'^Project:\s*`(.+?)`$', content, re.M)
    if slug_match: slug = slug_match.group(1).strip()
    
    status_match = re.search(r'^Status:\s*(.+)$', content, re.M)
    if status_match: status = status_match.group(1).strip().lower()
    
    owner_match = re.search(r'^Owner:\s*(.+)$', content, re.M)
    if owner_match: owner = owner_match.group(1).strip()

    # Section extraction
    tasks = []
    task_section = re.search(r'## Next steps\n\n(.*?)(?=\n\n##|\Z)', content, re.S)
    if task_section:
        tasks = [t.strip('- ').strip() for t in task_section.group(1).splitlines() if t.strip().startswith('-')]

    decisions = []
    decision_section = re.search(r'## Decisions\n\n(.*?)(?=\n\n##|\Z)', content, re.S)
    if decision_section:
        for line in decision_section.group(1).splitlines():
            line = line.strip('- ').strip()
            # Format: [YYYY-MM-DD] Decision: ... | Reason: ...
            match = re.match(r'\[(.*?)\]\s*Decision:\s*(.*?)(?:\s*\|\s*Reason:\s*(.*))?$', line)
            if match:
                decisions.append({
                    'date': match.group(1),
                    'decision': match.group(2),
                    'reason': match.group(3) or ''
                })

    return {
        'slug': slug,
        'title': title,
        'status': status,
        'owner': owner,
        'note_path': str(path),
        'tasks': tasks,
        'decisions': decisions
    }

for filename in os.listdir(projects_dir):
    if not filename.endswith('.md') or filename == 'README.md': continue
    path = Path(projects_dir) / filename
    p = parse_project_file(path)
    
    # Upsert Project
    conn.execute("""
        INSERT INTO projects (slug, title, status, owner, note_path, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(slug) DO UPDATE SET 
            title=excluded.title, 
            status=excluded.status, 
            owner=excluded.owner, 
            note_path=excluded.note_path,
            updated_at=CURRENT_TIMESTAMP
    """, (p['slug'], p['title'], p['status'], p['owner'], p['note_path']))
    
    project_id = conn.execute("SELECT id FROM projects WHERE slug = ?", (p['slug'],)).fetchone()['id']
    
    # Sync Tasks (Simple approach: mark old open tasks as done if not in Markdown, or just add new ones)
    # For now, let's just add missing ones to avoid deleting state manually managed in DB.
    for task_title in p['tasks']:
        conn.execute("""
            INSERT INTO tasks (project_id, title, status, source_type, source_ref, updated_at)
            SELECT ?, ?, 'open', 'project_next_step', ?, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = ? AND title = ?)
        """, (project_id, task_title, p['note_path'], project_id, task_title))

    # Sync Decisions
    for d in p['decisions']:
        conn.execute("""
            INSERT INTO decisions (project_id, decision, reason, source_type, source_ref, created_at)
            SELECT ?, ?, ?, 'project_note', ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE project_id = ? AND decision = ?)
        """, (project_id, d['decision'], d['reason'], p['note_path'], d['date'], project_id, d['decision']))

conn.commit()
conn.close()
PY
    echo "Markdown-to-SQLite sync completed." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
