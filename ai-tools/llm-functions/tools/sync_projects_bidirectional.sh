#!/usr/bin/env bash
set -e

# @describe Bidirectional sync between project Markdown notes and SQLite assistant database.

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

    echo "Syncing project notes bidirectionally..." >> "$LLM_OUTPUT"

    python3 - <<'PY' "$(db_path)" "$projects_dir"
import sqlite3
import os
import re
import sys
from pathlib import Path
from datetime import datetime

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

    # Section extraction (simple regex for demo)
    tasks = []
    task_section = re.search(r'## Next steps\n\n(.*?)(?=\n\n##|\Z)', content, re.S)
    if task_section:
        for line in task_section.group(1).splitlines():
            line = line.strip()
            if line.startswith('-'):
                # Handle both - task and - [ ] task
                match = re.match(r'^- (?:\[([ xX])\] )?(.+)$', line)
                if match:
                    tasks.append({
                        'title': match.group(2).strip(),
                        'done': match.group(1) in ['x', 'X']
                    })

    decisions = []
    decision_section = re.search(r'## Decisions\n\n(.*?)(?=\n\n##|\Z)', content, re.S)
    if decision_section:
        for line in decision_section.group(1).splitlines():
            line = line.strip('- ').strip()
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
        'decisions': decisions,
        'content': content
    }

def update_markdown_task(content, task_title, is_done):
    # Regex to find the task line and update its status
    new_status = '[x]' if is_done else '[ ]'
    pattern = re.compile(rf'^- (?:\[([ xX])\] )?({re.escape(task_title)})(\.?)$', re.M)
    
    def replacer(m):
        # preserve dot if present
        dot = m.group(2) if m.group(2) else ''
        return f"- {new_status} {task_title}{dot}"

    return pattern.sub(rf'- {new_status} \2\3', content)

for filename in os.listdir(projects_dir):
    if not filename.endswith('.md') or filename == 'README.md': continue
    path = Path(projects_dir) / filename
    p = parse_project_file(path)
    
    file_mtime = datetime.fromtimestamp(path.stat().st_mtime)
    
    # Check if project exists and get its update time
    db_project = conn.execute("SELECT * FROM projects WHERE slug = ?", (p['slug'],)).fetchone()
    
    db_is_newer = False
    if db_project:
        db_updated_at = datetime.strptime(db_project['updated_at'], '%Y-%m-%d %H:%M:%S')
        if db_updated_at > file_mtime:
            db_is_newer = True

    if db_is_newer:
        # Step B: SQLite to Markdown
        new_content = p['content']
        db_tasks = conn.execute("SELECT * FROM tasks WHERE project_id = ?", (db_project['id'],)).fetchall()
        for db_task in db_tasks:
            # If DB says it's done/blocked but MD doesn't, we update MD
            is_done_in_db = (db_task['status'] in ['done', 'archived'])
            new_content = update_markdown_task(new_content, db_task['title'], is_done_in_db)
        
        if new_content != p['content']:
            print(f"Updating {filename} from SQLite state...")
            path.write_text(new_content, encoding='utf-8')
            # Update file metadata to avoid immediate resync
            p = parse_project_file(path) 
    else:
        # Step A: Markdown to SQLite (Markdown is newer or identical)
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
        
        for task in p['tasks']:
            status = 'done' if task['done'] else 'open'
            conn.execute("""
                INSERT INTO tasks (project_id, title, status, source_type, source_ref, updated_at)
                SELECT ?, ?, ?, 'project_next_step', ?, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = ? AND title = ?)
            """, (project_id, task['title'], status, p['note_path'], project_id, task['title']))
            
            # If it exists, update the status from MD
            conn.execute("""
                UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE project_id = ? AND title = ? AND status != ?
            """, (status, project_id, task['title'], status))

        for d in p['decisions']:
            conn.execute("""
                INSERT INTO decisions (project_id, decision, reason, source_type, source_ref, created_at)
                SELECT ?, ?, ?, 'project_note', ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE project_id = ? AND decision = ?)
            """, (project_id, d['decision'], d['reason'], p['note_path'], d['date'], project_id, d['decision']))

conn.commit()
conn.close()
PY
    echo "Bidirectional sync completed." >> "$LLM_OUTPUT"
}

eval "$(argc --argc-eval "$0" "$@")"
