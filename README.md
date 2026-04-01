Here's the full and updated README content:

# 🧠 Local AI Assistant System

A sophisticated, proactive, and multi-agent AI operating system built for macOS. This system integrates local LLMs (via Ollama) with your Notes, Calendar, Reminders, and Filesystem to provide a data-driven, privacy-first personal assistant.

## 🚀 Key Features

*   **Multi-Agent Orchestration**: Specialized agents for daily tasks (`pa`), complex workflows (`wa`), file management (`fm`), coding (`coder`), todo lists (`todo`), notes organization (`notesAssistant`), personal assistance (`personalAssitant`), vision-based assistance (`visionAssistant`), weekly review summarization (`weeklyReview`), and project synchronization (`sync_projects_bidirectional`) are all integrated.
*   **Proactive Sync**: Background monitoring of project notes using `fswatch` and `launchd` for real-time SQLite and Apple Reminders synchronization, along with syncing tasks and reminders in both directions between project management tools and your local system using `sync_tasks_reminders`, file management via `fs_cp`, `fs_mv`, `fs_mkdir`, fs_rm, `fs_write` and web searching via `web_search_aichat`, `web_search_perplexity`, `web_search_tavily`, Wikipedia with `search_wikipedia`, Wolfram Alpha using `search_wolframalpha`, ArXiv with `search_arxiv`.
*   **Deep Context**: Integration with Safari/Chrome active tabs using `browser_get_active_tab`, vision-enhanced file organization (using `vision_analyze_organize`, `fs_organize`, `fs_rm`, `fs_write`), deep research (using `deep_research`), autonomous fixation (`autonomous_fix`), coding tasks (`execute_command`, `file_classify`, `file_find`), calendar-based task and event management via `calendar_check_conflicts`, `calendar_find_free_slots`, demo_sh demonstrating `demo_sh`, weather and time checks via `get_current_weather` and `get_current_time`, sending emails using `send_mail` and creating issues on GitHub using `gh_issue`. Additionally, fetching URLs using `fetch_url_via_curl`, `fetch_url_via_jina`, executing SQL code (`execute_sql_code`), getting the summary of a repository via `repo_summary`.
*   **Dyslexia-Aware**: Optimized instructions focused on intent and semantic meaning over literal spelling and grammar, as well as text classification and search via `file_classify`.

## 📁 Repository Structure

```
local-ai-assistant/
├── ai-tools/llm-functions/ # Core logic, agents, and tool definitions
    ├── tools/
        ├── auto_document
        ├── autonomous_fix
        ├── browser_get_active_tab
        ├── browser_project_match
        ├── calendar_check_conflicts
        ├── calendar_find_free_slots
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
        ├── log_feedback # Added tool to record feedback from users
        ├── optimize_instructions
        ├── repo_push
        ├── repo_summary
        ├── search_arxiv
        ├── search_wikipedia
        ├── search_wolframalpha
        └── send_mail
    ├── agents/
        ├── coder
        ├── todo
        ├── notesAssistant
        ├── personalAssitant
        ├── visionAssistant
        ├── weeklyReview 
        ├── workflowAgent # Updated tool for workflows and complex functions
        ├── fileManager  # Added new tool for file management and synchronization
        ├── repoManager   # Added new tool for repository management
        ├── syncTasksRemindersTool    # Added new tool to create reminders for todo list tasks
        └── syncMarkdownToSqliteTool # Added new tool for syncing markdown to SQLite database
└── zsh/                    # Shell helpers and aliases (.zsh_ai_helpers)
``` 

## 🛠️ Installation

1.  Clone this repository.
2.  Source the shell helpers: `source zsh/.zsh_ai_helpers`.
3.  Run `argc build` in `ai-tools/llm-functions` to register tools.
4.  Set up the background daemon: `launchctl load ~/Library/LaunchAgents/com.ai.assistant.syncwatcher.plist`.

## 💬 Usage

*   **Daily Brief**: `pa "morning brief"`
*   **Deep Research**: `pa "Perform deep research on [topic]"`
*   **File Organization**: `fm "Clean my Downloads folder"`
*   **Autonomous Fix**: `coder "Fix the failing tests in my project"`
*   **Todo List Management**: `todo add/new/delete/complete item`
*   **Notes Organization**: `notesAssistant organize new/view/update/search notes`
*   **Personal Assistance**: `personalAssitant help/instructions`
*   **Vision-Based Assistance**: `visionAssistant recognize/classify/analyze files`

---
Built with ❤️ for a more accessible and autonomous local AI experience.
