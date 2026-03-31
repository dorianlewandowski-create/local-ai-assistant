#!/usr/bin/env bash
set -e

# @describe Perform a deep, multi-turn autonomous research investigation.

# @option --topic! The high-level topic (e.g., "Local LLM Orchestration").
# @option --initial-query! The starting search query.
# @option --depth <INT> The number of research iterations (default 2).

# @env LLM_OUTPUT=/dev/stdout The output path

ROOT_DIR="${LLM_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

main() {
    local topic="$argc_topic"
    local query="$argc_initial_query"
    local depth="${argc_depth:-2}"

    echo "Starting deep research on '$topic' (depth: $depth)..." >> "$LLM_OUTPUT"

    python3 - <<'PY' "$topic" "$query" "$depth" "$ROOT_DIR"
import sys
import json
import subprocess
import os
from pathlib import Path

topic, initial_query, depth, root_dir = sys.argv[1:5]
depth = int(depth)
root_path = Path(root_dir)
bin_dir = root_path / 'bin'

findings = []
all_sources = []

current_query = initial_query

for i in range(1, depth + 1):
    print(f"\n--- Iteration {i}/{depth}: Searching for '{current_query}' ---")
    
    # 1. Search (using DuckDuckGo via web_search_aichat if available, or just aichat)
    search_cmd = [str(bin_dir / 'web_search_aichat'), json.dumps({"query": current_query, "limit": 5})]
    search_proc = subprocess.run(search_cmd, capture_output=True, text=True)
    search_results = search_proc.stdout.strip()
    
    # 2. Fetch top results
    # For simplicity, we parse the search results for URLs and call fetch_url
    urls = []
    for line in search_results.splitlines():
        if '|' in line and 'http' in line:
            parts = line.split('|')
            url = parts[-1].strip()
            if url.startswith('http'):
                urls.append(url)
    
    iteration_evidence = []
    for url in urls[:2]: # Fetch top 2
        print(f"Fetching: {url}")
        fetch_proc = subprocess.run([str(bin_dir / 'fetch_url_via_curl'), json.dumps({"url": url})], capture_output=True, text=True)
        iteration_evidence.append(f"Source: {url}\nContent: {fetch_proc.stdout.strip()[:2000]}")
    
    # 3. Analyze and Plan Next Step
    analysis_prompt = f"""
    Current Topic: {topic}
    Research findings so far:
    {' '.join(findings)}
    
    New evidence from this iteration:
    {' '.join(iteration_evidence)}
    
    1. Summarize the key facts found in this iteration.
    2. Identify what is still missing or unclear.
    3. Suggest a better, more specific search query for the NEXT iteration.
    
    Format as JSON: {{"summary": "...", "missing": "...", "next_query": "..."}}
    """
    
    analysis_proc = subprocess.run(['aichat', '-m', 'ollama:llama3.1:8b', analysis_prompt], capture_output=True, text=True)
    try:
        # Clean up potential markdown blocks from aichat output
        raw_json = analysis_proc.stdout.strip()
        if '```json' in raw_json:
            raw_json = raw_json.split('```json')[1].split('```')[0].strip()
        elif '{' in raw_json:
            raw_json = raw_json[raw_json.find('{'):raw_json.rfind('}')+1]
            
        analysis = json.loads(raw_json)
        findings.append(analysis.get('summary', ''))
        current_query = analysis.get('next_query', current_query)
        all_sources.extend(urls[:2])
    except:
        findings.append(f"Iteration {i} summary failed to parse.")
        break

# 4. Final Synthesis
final_prompt = f"""
Synthesize a comprehensive research report for the topic: {topic}
Findings:
{chr(10).join(findings)}
Sources:
{chr(10).join(all_sources)}

Format the report in high-quality Markdown with sections:
# {topic}
## Executive Summary
## Detailed Findings
## Key Sources
## Recommendations / Next Steps
"""
final_proc = subprocess.run(['aichat', '-m', 'ollama:llama3.1:8b', final_prompt], capture_output=True, text=True)
final_report = final_proc.stdout.strip()

# 5. Save to Note and SQLite
slug = topic.lower().replace(' ', '-')
note_path = Path.home() / 'Notes' / 'research' / f"{slug}.md"
note_path.parent.mkdir(parents=True, exist_ok=True)
note_path.write_text(final_report, encoding='utf-8')

# SQLite Upsert
db_path = Path.home() / 'Notes' / 'assistant.db'
if db_path.exists():
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO research_topics (slug, title, note_path, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET updated_at=CURRENT_TIMESTAMP", (slug, topic, str(note_path)))
    topic_id = conn.execute("SELECT id FROM research_topics WHERE slug = ?", (slug,)).fetchone()[0]
    conn.execute("INSERT INTO research_items (topic_id, summary, source_type, created_at) VALUES (?, ?, 'deep_research', CURRENT_TIMESTAMP)", (topic_id, final_report[:500] + '...', 'deep_research'))
    conn.commit()
    conn.close()

print(f"\nDeep research complete! Report saved to: {note_path}")
PY
}

eval "$(argc --argc-eval "$0" "$@")"
