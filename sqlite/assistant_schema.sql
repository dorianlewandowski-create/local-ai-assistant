CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  owner TEXT,
  health_score INTEGER DEFAULT 50,
  health_label TEXT DEFAULT 'active',
  note_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_reviewed_at TEXT
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT DEFAULT 'medium',
  due_at TEXT,
  source_type TEXT,
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE TABLE inbox_items (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT,
  suggested_target_type TEXT,
  suggested_target_ref TEXT,
  confidence REAL DEFAULT 0.0,
  applied INTEGER DEFAULT 0,
  applied_target_type TEXT,
  applied_target_ref TEXT,
  created_at TEXT,
  applied_at TEXT,
  source_line INTEGER
);
CREATE TABLE project_updates (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  update_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_type TEXT,
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER,
  decision TEXT NOT NULL,
  reason TEXT,
  source_type TEXT,
  source_ref TEXT,
  created_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_inbox_applied ON inbox_items(applied);
CREATE INDEX idx_decisions_project_created ON decisions(project_id, created_at);
CREATE TABLE research_topics (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  note_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE research_items (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER,
  query TEXT,
  source_title TEXT,
  source_url TEXT,
  source_domain TEXT,
  source_type TEXT,
  summary TEXT,
  followups TEXT,
  created_at TEXT,
  FOREIGN KEY (topic_id) REFERENCES research_topics(id) ON DELETE SET NULL
);
CREATE INDEX idx_research_topic_created ON research_items(topic_id, created_at);
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date TEXT,
  note_path TEXT,
  summary TEXT,
  decisions TEXT,
  action_items TEXT,
  open_questions TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
