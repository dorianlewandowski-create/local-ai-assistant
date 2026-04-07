#  OpenMac | Autonomous OS Agent for Power Users (v0.7.4)

OpenMac is a local-first, distributed autonomous macOS agent designed for operators who want a persistent, high-signal command layer over their workstation. It combines local reasoning, a dense mission-control TUI, a self-improving cognitive architecture, and deep macOS integration into a single platform built for elite personal workflows.

![OpenMac TUI Dashboard](assets/tui-preview.png)

## 🚀 The v0.7.4 Evolution: Cognitive Sovereignty

Version 0.7.4 transforms OpenMac from a local utility into a sophisticated, self-evolving autonomous platform.

- **Distributed Control Plane**: Decoupled Daemon/Client architecture. The runtime runs as a background service (`openmac daemon`), while the TUI and CLI connect as remote clients.
- **Self-Improving Tiered Memory**: A cognitive system using **HOT** (Always Loaded), **WARM** (Contextual), and **COLD** (Archived) memory tiers. The agent learns from corrections and reflects on every complex task.
- **Autonomous Self-Evolution**: Equipped with tools to research unfamiliar apps (`research_app_automation`) and write its own skills (`create_new_skill`) at runtime.
- **Multimodal Vision & Deep Web**: Integrated screen analysis (Vision) and full headless browser control (Puppeteer) for interacting with any interface, scriptable or not.
- **Transactional Safety**: Built-in checkpoint and rollback systems for reliable, high-risk file operations.

## 🏗️ Core Pillars

- 🧠 **Local Model Orchestration**: Privacy-first routing between optimized local models (Llama 3, DeepSeek, Qwen) for different task tiers (Reasoning, Fast, Vision, Coding).
- 📟 **Resident Daemon Mode**: Background execution via `launchd` with seamless TUI/CLI connectivity.
- 📱 **Multi-Gateway Command Center**: Remote control via Telegram, Slack, and WhatsApp with secure pairing and remote-safe policies.
- 💾 **Tiered Cognitive Store**: SQLite facts, LanceDB vector memory, and Markdown-based self-improving memory logs.
- 🔐 **Hardened Security**: Local Keychain-based credential management, audit logs, and transactional rollbacks.

## 🛠️ Integrated Skill Stack

OpenMac comes pre-equipped with elite-level plugins:
- **Productivity OS**: Structured energy and task management based on life-operating system frameworks.
- **Garmin Connect**: Health-aware assistance using real-time fitness and recovery metrics.
- **Tech News Pipeline**: 150-source automated information synthesis and deduplication.
- **Web Search Plus**: Intelligent auto-routing between Google (Serper), Tavily (Research), and Exa (Neural).
- **Shortcuts Bridge**: Direct access to native macOS Apple Shortcuts.

## 🏁 Getting Started

### 1. Installation
```bash
git clone <your-repo-url>
cd mac-ai-assistant
npm install
npm run onboard
npm link
```

### 2. Run as a Service (Recommended)
```bash
# Install and load the launchd agent
npm run launchd:install

# Or start the daemon manually
openmac daemon
```

### 3. Launch the Mission Control
```bash
# Connect the TUI to the running daemon
openmac
```

## 🧠 Operational Philosophy

OpenMac is built in the style of a **distributed operator console**. It doesn't just "chat"—it observes, reasons, learns, and acts as your local human proxy.

- **Learn from Corrections**: When you correct the agent, it logs the pattern to its WARM memory.
- **Compound Knowledge**: Every interaction makes the agent smarter through its Self-Reflection loop.
- **Privacy First**: Everything runs locally by default. Cloud APIs are an optional choice, not a requirement.

## 🔒 Security & Safety

- **Keychain Integration**: Store sensitive tokens (like Garmin) in the native macOS Keychain.
- **Checkpoints**: Use `checkpoint_start` before high-risk operations to ensure you can always `rollback`.
- **Remote Safe Mode**: Limit remote commands to a specific allowlist of tools and permissions.

---
*OpenMac v0.7.4 — The definitive autonomous control plane for macOS.*
