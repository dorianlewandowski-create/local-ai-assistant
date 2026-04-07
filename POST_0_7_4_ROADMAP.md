# Post 0.7.4 Roadmap: The Cognitive Sovereignty Era

This roadmap tracks the evolution of OpenMac from a local orchestrator to a fully autonomous, self-improving agent platform.

## Phase 17: Cognitive Sovereignty (Memory & Learning) ✅
- [x] Implement Tiered Memory System (HOT/WARM/COLD)
- [x] Add autonomous Self-Reflection loop after complex tasks
- [x] Implement `log_correction` to learn from user feedback
- [x] Create contextual memory loading (Warm Memory) based on task intent
- [x] Establish "3x Rule" for promoting patterns to HOT memory

## Phase 18: Distributed Control Plane (Service Architecture) ✅
- [x] Decouple Runtime Host into a background Daemon (`openmac daemon`)
- [x] Implement remote TUI/CLI connectivity via RuntimeServiceClient
- [x] Add SSE-based log streaming from Daemon to remote clients
- [x] Migrate all gateways (Telegram, Slack, WhatsApp) to the service boundary
- [x] Update `launchd` integration for resident service execution

## Phase 19: Multimodal GUI Mastery (Vision & Clicks) ✅
- [x] Integrated screenshot-based Vision analysis via Ollama (Llava)
- [x] Implement native `vision_click_at` for coordinate-based interaction
- [x] Add `vision_get_screen_snapshot` for non-scriptable UI discovery
- [x] Establish "Vision Fallback" logic in the agent's behavioral principles

## Phase 20: Autonomous Evolution (Self-Writing Skills) ✅
- [x] Implement dynamic `/skills` directory for runtime extensibility
- [x] Create `research_app_automation` for autonomous app discovery
- [x] Add `create_new_skill` to allow agent-authored AppleScript/Shell tools
- [x] Implement "Self-Evolution" loop: Research -> Extract -> Create -> Register

## Phase 21: Deep Web Interaction (Headless Browser) ✅
- [x] Integrated Puppeteer for full headless browser control
- [x] Add `web_browse`, `web_click`, `web_type`, and `web_extract` tools
- [x] Link web snapshots to the Multimodal Vision layer for layout analysis
- [x] Enable complex web workflows (logins, form-filling, data scraping)

## Phase 22: Transactional Integrity (Safety Nets) ✅
- [x] Implement `checkpoint_start` for multi-file backup before risky operations
- [x] Add `checkpoint_rollback` for instant recovery from failed tasks
- [x] Implement `checkpoint_commit` for clean state finalization
- [x] Update SOUL to mandate checkpoints for all high-risk system edits

---

## 🚀 Future Horizons (0.8.0 and Beyond)

### Phase 23: Commander Mode (Multi-Agent Swarms)
- [ ] Refine `spawn_helper_agent` for complex parallel tasking
- [ ] Add inter-agent communication channels
- [ ] Implement hierarchical task decomposition
- [ ] Add "Reviewer" agents for code/script quality control

### Phase 24: Native Apple Ecosystem Mastery
- [ ] Deepen Shortcuts Bridge with input/output variable support
- [ ] Implement native HomeKit/Matter control skill
- [ ] Add support for Focus Modes and Screen Time monitoring
- [ ] Integrate with local Mail/Calendar/Reminders database directly (bypass UI)

### Phase 25: Performance & Privacy Optimization
- [ ] Add local RAG optimization for the 150-source news pipeline
- [ ] Implement model quant-level routing (Fast vs. Precise)
- [ ] Add support for specialized "Coder" and "Vision" local models
- [ ] Implement fully offline Whisper-based transcription (bypass server entirely)

---
*OpenMac Roadmap — Building the definitive autonomous control plane.*
