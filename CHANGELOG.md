# Changelog

All notable changes to this project are documented here. Apex uses [Semantic Versioning](https://semver.org/) for released versions; `-rc` tags indicate **release candidates** for developers and operators.

## [1.0.0-rc.1] — 2026-04-11

First **v1 release candidate** aimed at **developers and operators** who install from **source (pnpm)** or from a **maintainer-built tarball** (see `docs/INSTALL_AND_RELEASE.txt`). This is **not** a consumer App Store product and is **not** Apple-signed or notarized.

### What Apex is

A local macOS control plane: CLI + optional daemon, localhost-authenticated runtime HTTP API, tools/skills/plugins, optional chat gateways (with pairing), and native macOS integration via a bundled **native bridge** (`nodes/macos`). Security and trust boundaries are described honestly in **`docs/OPERATOR_TRUST.txt`** and **`docs/PAIRING_SECURITY.txt`**.

### What is stable in this RC

- **Runtime trust model:** localhost API, shared-secret token for `/api/*`, documented first-run and 401 behavior (`apex runtime-info`).
- **Install/drift visibility:** install root and stale-token class issues are diagnosable (`apex runtime-info`, launchd plist `APEX_INSTALL_ROOT`).
- **Contributor workflow:** `pnpm` + `pnpm-lock.yaml` at repo root; `pnpm run ci:quick` matches Ubuntu CI static checks.
- **Skill JSON:** bundled `src/skills/**/*.json` are **strict JSON**; `pnpm run validate:skill-json` enforces parity with `JSON.parse` / Python `json.load` (see `docs/SKILL_JSON_CONTRACT.txt`).
- **Release staging:** flattened manifest (no `workspace:` in tarball), vendored `nodes/macos`, staging-generated `package-lock.json`, `npm install` → `npm ci` in staging; `release:verify` checks vendored paths, lockfile reference, and `require('@apex/macos-node')` (macOS CI runs `release:pack` + `release:verify`).

### What is intentionally not in v1

- **Consumer-grade distribution:** no DMG/App Store pipeline, no universal “double-click installer” story.
- **Code signing / notarization:** not part of this RC; see README “macOS downloads and Gatekeeper.”
- **Guarantee of whole-process App Sandbox** (see README and `docs/OPERATOR_TRUST.txt`).

### Known limitations (read before relying on v1)

- **macOS Gatekeeper / quarantine:** Browsers may mark downloaded archives with **quarantine**; **unsigned** binaries and local developer tools may trigger **Security & Privacy** prompts. That is **expected** for this distribution model. See README and `docs/INSTALL_AND_RELEASE.txt`.
- **Pairing rate limits** are in-process (reset on daemon restart); see `docs/PAIRING_SECURITY.txt`.
- **Tarball “cold” install** (extract to a clean directory only) is validated in spirit via staging + verify; a **fully offline** extract is still a good **manual** pre-release smoke test for maintainers.

### Maintainer pre-tag checklist (suggested)

1. `pnpm install --frozen-lockfile && pnpm run check` (or at least `pnpm run ci:quick` + `pnpm run build` + `pnpm test`).
2. On **macOS:** `pnpm run release:pack && pnpm run release:verify`.
3. Optionally: extract `releases/apex-<version>.tar.gz` to a **new empty directory**, run `npm ci --omit=dev`, confirm `./bin/apex` runs (same toolchain as documented tarball path).

Tag **`v1.0.0-rc.1`** on your forge when publishing; no upstream URL is implied here.
