Here's the full and updated README content:

# 🧠 Local AI Assistant System

A sophisticated, proactive, and multi-agent AI operating system built for macOS. This system integrates local LLMs (via Ollama) with your Notes, Calendar, Reminders, and Filesystem to provide a data-driven, privacy-first personal assistant.

## 🚀 Key Features

*   **Multi-Agent Orchestration**: Specialized agents for daily tasks (`pa`), complex workflows (`wa`), file management (`fm`), coding (`coder`), todo lists (`todo`), notes organization (`notesAssistant`), personal assistance (`personalAssitant`), vision-based assistance (`visionAssistant`), weekly review summarization (`weeklyReview`), project synchronization via `sync_projects_bidirectional`, file manager via `fileManager`, and repository management using `repoManager` are all integrated.
*   **Proactive Sync**: Background monitoring of project notes using `fswatch` and `launchd` for real-time SQLite and Apple Reminders synchronization, along with syncing tasks, reminders in both directions between project management tools and your local system via `sync_tasks_reminders`, file management via `fs_cp`, `fs_mv`, `fs_mkdir`, fs_rm, `fs_write` as well as web searching using `web_search_aichat`, `web_search_perplexity`, `web_search_tavily`, Wikipedia with `search_wikipedia`, Wolfram Alpha via `search_wolframalpha`, and ArXiv with `search_arxiv`.
*   **Deep Context**: Integration with Safari/Chrome active tabs using `browser_get_active_tab` as well as vision-enhanced file organization via `vision_analyze_organize`, `fs_organize`, `fs_rm`, `fs_write`, deep research using `deep_research`, autonomous fixation (`autonomous_fix`), coding tasks (`execute_command`, `file_classify`, `file_find`), calendar-based task and event management through `calendar_check_conflicts`, `calendar_find_free_slots`, demo_sh demonstrating capabilities of `demo_sh`, weather and time checks via `get_current_weather` and `get_current_time`, sending emails using `send_mail`, creating issues on GitHub with `gh_issue`. Additionally, fetching URLs via `fetch_url_via_curl`, `fetch_url_via_jina`, executing SQL code (`execute_sql_code`), getting the summary of a repository via `repo_summary`.
*   **Dyslexia-Aware**: Optimized instructions focused on intent and semantic meaning over literal spelling and grammar as well as text classification and search via `file_classify`. Note integration with Notes, Calendar and Reminders using various commands like:
    *   `get_current_time`
    *   `get_current_weather`
    *   `gh_issue create/review/assign issues`
    *   `mail_read` and related mail search and read tools to fetch inbox contents

## 📁 Repository Structure

```
local-ai-assistant/
├── ai-tools/llm-functions/ # Core logic, agents, and tool definitions
    ├── tools/
        ├── auto_document
        ├── autonomous_fix
        ├── browse_get_active_tab
        ├── browser_project_match
        ├── calendar_check_conflicts
        ├── calendar_find_free_slots
        ├── consult_agent  # New tool to get information from other agents
        ├── decode
        ├── deep_research
        ├── delegate_to_workflow
        ├── demo_sh
        ├── execute_command
        ├── execute_sql_code
        ├── fetch_url_via_curl
        ├── fetch_url_via_jina
        ├── file_classify
        ├── file_find
        ├── fs_cat
        ├── fs_cp
        ├── fs_ls
        ├── fs_mkdir
        ├── fs_mv
        ├── fs_organize
        ├── fs_patch
        ├── fs_rm
        ├── fs_write
        ├── get_current_time
        ├── get_current_weather
        ├── gh_issue
        ├── log_feedback  # New tool to record feedback from users
        ├── optimize_instructions
        ├── repo_push
        ├── repo_summary
        ├── send_mail
        ├── send_twilio  # New tool for sending SMS messages via Twilio API
        ├── search_arxiv
        ├── search_wikipedia
        ├── search_wolframalpha
        └── sync_markdown_to_sqlite
    ├── agents/
        ├── coder
        ├── todo
        ├── notesAssistant
        ├── personalAssitant
        ├── visionAssistant
        ├── weeklyReview 
        ├── workflowAgent
        ├── fileManager  # New agent for file management and synchronization
        ├── repoManager   # New agent for repository management
        └── swarm  # Agent for managing workloads

## 🛠️ Installation

1.  Clone this repository.
2.  Source the shell helpers: `source zsh/.zsh_ai_helpers`.
3.  Run `argc build` in `ai-tools/llm-functions` to register tools and agents.
4.  Set up the background daemon: `launchctl load ~/Library/LaunchAgents/com.ai.assistant.syncwatcher.plist`.

## 💬 Usage

*   **Daily Brief**: `pa "morning brief"`
*   **Deep Research**: `pa "Perform deep research on [topic]"`
*   **Code Completion and Fixtures Testing**: `coder ["complete code" | "test fixtures"]`
*   **Todo List Management**: `todo add/new/delete/complete item`
*   **Notes Organization**: 
    +   Search notes: `notesAssistant search query` (e.g., `title`,  `content` or tag) 
    +   Add new note and auto-index and make relevant fields auto-fill for quick retrieval
    +   Manage all tasks from single command: `todo add [list] to manage list`
*   **Personal Assistance**:  Use `consult agent <agent_name>` to ask an integrated agent to "explain how" a task is completed. 
                                    This example helps complete many tasks, with the ability to provide multiple ways of explanation or to summarize in simpler language.
    As of today there are:
+ personalAssitant (general knowledge and research)
+ visionAssistant (task automation using images as input)
