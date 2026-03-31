# 🧠 Local AI Assistant System

A sophisticated, proactive, and multi-agent AI operating system built for macOS. This system integrates local LLMs (via Ollama) with your Notes, Calendar, Reminders, and Filesystem to provide a data-driven, privacy-first personal assistant.

## 🚀 Key Features

- **Multi-Agent Orchestration**: Specialized agents for daily tasks (`pa`), complex workflows (`wa`), file management (`fm`), and coding (`coder`).
- **Proactive Sync**: Background monitoring of project notes using `fswatch` and `launchd` for real-time SQLite and Apple Reminders synchronization.
- **Deep Context**: Integration with Safari/Chrome active tabs, vision-enhanced file organization, and multi-turn autonomous research loops.
- **Dyslexia-Aware**: Optimized instructions focused on intent and semantic meaning over literal spelling and grammar.

## 📁 Repository Structure

```
local-ai-assistant/
├── ai-tools/llm-functions/ # Core logic, agents, and tool definitions
├── docs/                   # Architectural summaries and usage guides
├── examples/               # Example interaction logs
├── sqlite/                 # Database schema and migrations
└── zsh/                    # Shell helpers and aliases (.zsh_ai_helpers)
```

## 🛠️ Installation

1. Clone this repository.
2. Source the shell helpers: `source zsh/.zsh_ai_helpers`.
3. Run `argc build` in `ai-tools/llm-functions` to register tools.
4. Set up the background daemon: `launchctl load ~/Library/LaunchAgents/com.ai.assistant.syncwatcher.plist`.

## 💬 Usage

- **Daily Brief**: `pa "morning breef"`
- **Deep Research**: `pa "Perform deep research on [topic]"`
- **File Organization**: `fm "Clean my Downloads folder"`
- **Autonomous Fix**: `coder "Fix the failing tests in my project"`

---
Built with ❤️ for a more accessible and autonomous local AI experience.
