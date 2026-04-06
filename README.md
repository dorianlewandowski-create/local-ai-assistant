#  OpenMac | Autonomous OS Agent for Power Users

OpenMac is a local-first autonomous macOS agent designed for operators who want a persistent, high-signal command layer over their workstation. It combines elite local reasoning, a dense mission-control TUI, Telegram-based remote control, and semantic long-term memory into a single system built for serious personal automation.

![OpenMac TUI Dashboard](assets/tui-preview.png)

Save the TUI screenshot at `assets/tui-preview.png` to render the preview above.

## Core Pillars

- 🧠 **Elite Reasoning**: Powered by Google Gemma 4 via Ollama.
- 📟 **High-Density TUI**: A mission-control interface built with `neo-blessed`.
- 📱 **Telegram Command Center**: Remote screenshotting, status checks, and file analysis.
- 💾 **Semantic Memory**: Persistent vector storage using LanceDB for long-term recall.

## Architecture

OpenMac is structured as a living agent rather than a single-turn assistant.

- A resident orchestrator manages tasks from the terminal, file watchers, and gateways.
- Specialized sub-agents split work across research, coding, and system operations.
- LanceDB stores semantic memory for contextual recall across sessions.
- Telegram acts as a secure remote surface for commands, screenshots, and image-triggered analysis.
- The TUI presents a dense operational view of chat, reasoning, and system I/O in real time.

## Getting Started

1. Clone the repository.

```bash
git clone <your-repo-url>
cd mac-ai-assistant
```

2. Install dependencies.

```bash
npm install
```

3. Create your local environment file.

```bash
cp .env.example .env
```

4. Fill in the required values inside `.env`.

5. Link the global command.

```bash
npm link
```

6. Run OpenMac from anywhere.

```bash
openmac
```

## Required Environment

At minimum, configure the following inside `.env`:

```env
TELEGRAM_ENABLED=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
OLLAMA_MODEL=
```

Additional optional keys are included in `.env.example` for advanced integrations.

## Telegram Command Center

OpenMac supports a secure Telegram control path bound to a single allowed chat ID.

- `/start` boots the remote session.
- `/status` reports system state.
- `/screen` captures the current desktop.
- Sending plain text creates a task.
- Sending a photo triggers image analysis through the agent pipeline.

## Security

Your `.env` file contains tokens, identifiers, and runtime configuration. Keep it private.

- `.env` is ignored by git.
- Never commit production tokens.
- Restrict Telegram access to your own `TELEGRAM_CHAT_ID`.
- Treat screenshots and local memory data as sensitive operator context.

## Developer Notes

- Local model runtime: Ollama
- Default orchestration model: Gemma 4
- Vector memory: LanceDB
- Terminal interface: `neo-blessed`
- Persistent memory: SQLite + semantic retrieval

## Operational Philosophy

OpenMac is built in the style of a local operator console: low-latency, high-visibility, and deeply integrated with the host machine. The goal is not chat for chat’s sake. The goal is an intelligent control surface for macOS that remembers, observes, reasons, and acts.
