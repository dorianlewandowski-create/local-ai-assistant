# OpenMac Implementation Checklist

Use this file to track progress against the roadmap.

## Phase 1: Stabilize Current App

- [x] Add `lint`, `typecheck`, and `test` scripts to `package.json`
- [x] Add a basic GitHub Actions CI workflow
- [x] Add Markdown escaping for Telegram replies in `src/gateways/telegram.ts`
- [x] Move hard-coded runtime settings from `src/index.ts` into config/env
- [x] Add startup validation for env, Ollama, vector store, and macOS command availability

## Phase 2: Separate Config From Runtime

- [x] Add `openmac.json` support
- [x] Merge config from file and env
- [x] Replace direct `process.env` reads with config access
- [x] Add `openmac doctor` command

## Phase 3: Fix Queueing And Session Boundaries

- [x] Replace the single global `TaskQueue` with keyed queues
- [x] Queue by `source + sourceId`
- [x] Give watcher and scheduler their own queues
- [x] Add task timeout and cancellation support
- [x] Add queue status to TUI

## Phase 4: Harden Remote Safety

- [x] Replace single `TELEGRAM_CHAT_ID` auth with pairing/approval
- [x] Add per-tool permission classes
- [x] Add approval expiry
- [x] Log all approvals and denials
- [x] Add a remote-safe mode for dangerous tools

## Phase 5: Split The Monolith

- [x] Separate core runtime from gateways
- [x] Separate tools from clients
- [x] Move TUI into a client layer
- [x] Reduce cross-module coupling in `src/index.ts`

## Phase 6: Introduce Real Session State

- [x] Add session objects keyed by source/sourceId
- [x] Store recent message history per session
- [x] Add scoped memory: global, per-session, per-source
- [x] Support per-session settings

## Phase 7: Add Provider Abstraction

- [ ] Create an LLM provider interface
- [ ] Move Ollama calls behind the provider
- [ ] Separate chat, embeddings, and vision providers
- [ ] Add optional fallback provider support

## Phase 8: Improve Tooling Surface

- [ ] Add tool categories and metadata
- [ ] Add a standard tool result shape
- [ ] Add tool execution logs
- [ ] Improve schema validation error handling

## Recommended First Milestone

- [x] Add `src/config.ts`
- [x] Refactor `src/index.ts` to use config instead of hard-coded values
- [x] Fix Telegram Markdown reply safety
- [x] Add lint/typecheck scripts
- [x] Add a basic GitHub Actions workflow
