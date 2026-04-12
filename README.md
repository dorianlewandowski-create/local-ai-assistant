# Apex

![Version](https://img.shields.io/badge/version-1.0.0--rc.1-blue)
![Platform](https://img.shields.io/badge/platform-macOS-black)
![License](https://img.shields.io/badge/license-MIT-green)

**A Mac-first local AI control plane for developers and operators.**

Apex lets you run and control AI workflows locally with a clear, explicit trust model, deep system integration, and a CLI-first interface.

> ⚠️ **v1.0.0-rc.1** — release candidate for technical users (not a consumer app yet)

---

## What Apex is

Apex is not “just another CLI” or “just another agent.”

It is a **local control plane** that sits between:

* your **LLMs**
* your **tools / automations**
* your **system (macOS)**

and gives you:

* a persistent **daemon + runtime API**
* a **terminal mission control**
* structured **memory + tools + skills**
* a clear, inspectable **trust model**

---

## Why Apex exists

Most AI tooling today is:

* opaque (hidden state, hidden decisions)
* remote-first (unclear data boundaries)
* hard to debug

Apex takes the opposite approach:

* **local-first**
* **explicit over implicit**
* **observable over magical**

---

## Core capabilities

* **Local runtime with token-based auth**
* **`apex runtime-info` for real debugging**
* **macOS integration (launchd, native bridge, system tools)**
* **Tool + skill system (extensible)**
* **Gateway integrations (Telegram, etc.)**
* **Deterministic release + install flow**

---

## Install (quick start)

### From source (recommended)

```bash
pnpm install
pnpm run build
./bin/run.sh
```

### From release tarball

```bash
tar -xzf apex-<version>.tar.gz
cd apex-<version>
npm ci --omit=dev
./bin/apex
```

---

## Who this is for

Apex is built for:

* developers building AI workflows
* operators running local automation
* users comfortable with:

  * terminal workflows
  * pnpm / npm
  * macOS system behavior

Not for:

* non-technical users
* “click to install” expectations (yet)

---

## Status

* Version: **v1.0.0-rc.1**
* Stable: runtime, CLI, release flow
* In progress: distribution UX, macOS trust ergonomics

See [`CHANGELOG.md`](./CHANGELOG.md) for details.

---

## Documentation

* `docs/OPERATOR_TRUST.txt` — security model
* `docs/INSTALL_AND_RELEASE.txt` — install + release flow
* `docs/PAIRING_SECURITY.txt` — gateway pairing model

---

## Philosophy

Apex is built on a simple idea:

> **You should be able to understand, inspect, and control your AI system.**

No hidden state. No fake guarantees. No magic.

---

## Feedback

This is a release candidate — feedback matters.

Open issues or share:

* install friction
* runtime confusion
* macOS integration issues
* gateway/pairing edge cases
