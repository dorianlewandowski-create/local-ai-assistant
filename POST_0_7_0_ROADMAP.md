# Post 0.7.0 Roadmap

Use this file to track the next round of improvements after `0.7.0`.

## Phase 9: Add Fallback Provider Support

- [x] Add fallback chat provider support
- [x] Add fallback embedding provider support
- [x] Add provider retry/failover policy
- [x] Add config for primary and fallback models
- [x] Add tests for provider failover behavior

## Phase 10: Persist Sessions

- [x] Persist session settings across restarts
- [x] Persist recent session summaries or history snapshots
- [x] Restore session state on startup
- [x] Add session pruning/retention policy
- [x] Add tests for session persistence

## Phase 11: Improve Channel Parity

- [ ] Bring Slack closer to Telegram feature parity
- [ ] Bring WhatsApp closer to Telegram feature parity
- [ ] Add channel-specific approval UX where supported
- [ ] Add consistent reply formatting/chunking across channels
- [ ] Add clearer unsupported-channel behavior

## Phase 12: Add Admin Command Surface

- [x] Add `/doctor`
- [x] Add `/queue`
- [x] Add `/approvals`
- [x] Add `/sessions`
- [x] Add `/memory`
- [x] Add `/safe on|off`
- [x] Add `/model`

## Phase 13: Build Web Control UI

- [x] Add a lightweight local web dashboard
- [x] Show queue and session status
- [x] Show approval requests and audit log entries
- [x] Add memory search/view tools
- [x] Add gateway and runtime health view

## Phase 14: Improve Remote Safety Further

- [ ] Add stronger sandboxing for remote sessions
- [x] Add per-channel tool allowlists
- [x] Add per-session tool policy overrides
- [x] Add explicit tool manifests instead of mostly inferred metadata
- [x] Add better audit browsing and filtering

## Phase 15: Improve Media Pipeline

- [ ] Add audio/voice-note ingestion
- [ ] Add speech-to-text support
- [ ] Add document/media size limits
- [ ] Add stronger temp-file lifecycle management
- [ ] Add better user-facing media failure messages

## Phase 16: Improve Packaging And Onboarding

- [ ] Add `openmac onboard`
- [ ] Add launchd install/support
- [ ] Add `openmac update`
- [ ] Improve release packaging
- [ ] Expand `doctor` checks and recovery hints

## Recommended Next Milestone

- [x] Add fallback provider support
- [x] Persist session settings
- [ ] Improve Slack and WhatsApp behavior
- [x] Add basic admin commands
- [x] Design the web control UI surface
