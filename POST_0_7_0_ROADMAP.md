# Post 0.7.0 Roadmap

Use this file to track the next round of improvements after `0.7.0`.

## Phase 9: Add Fallback Provider Support

- [x] Add fallback chat provider support
- [x] Add fallback embedding provider support
- [x] Add provider retry/failover policy
- [x] Add config for primary and fallback models
- [x] Add tests for provider failover behavior

## Phase 10: Persist Sessions

- [ ] Persist session settings across restarts
- [ ] Persist recent session summaries or history snapshots
- [ ] Restore session state on startup
- [ ] Add session pruning/retention policy
- [ ] Add tests for session persistence

## Phase 11: Improve Channel Parity

- [ ] Bring Slack closer to Telegram feature parity
- [ ] Bring WhatsApp closer to Telegram feature parity
- [ ] Add channel-specific approval UX where supported
- [ ] Add consistent reply formatting/chunking across channels
- [ ] Add clearer unsupported-channel behavior

## Phase 12: Add Admin Command Surface

- [ ] Add `/doctor`
- [ ] Add `/queue`
- [ ] Add `/approvals`
- [ ] Add `/sessions`
- [ ] Add `/memory`
- [ ] Add `/safe on|off`
- [ ] Add `/model`

## Phase 13: Build Web Control UI

- [ ] Add a lightweight local web dashboard
- [ ] Show queue and session status
- [ ] Show approval requests and audit log entries
- [ ] Add memory search/view tools
- [ ] Add gateway and runtime health view

## Phase 14: Improve Remote Safety Further

- [ ] Add stronger sandboxing for remote sessions
- [ ] Add per-channel tool allowlists
- [ ] Add per-session tool policy overrides
- [ ] Add explicit tool manifests instead of mostly inferred metadata
- [ ] Add better audit browsing and filtering

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
- [ ] Persist session settings
- [ ] Improve Slack and WhatsApp behavior
- [ ] Add basic admin commands
- [ ] Design the web control UI surface
