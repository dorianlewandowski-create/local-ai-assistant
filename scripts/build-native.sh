#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$ROOT_DIR/nodes/macos/claw-native-bridge"

if ! command -v swift >/dev/null 2>&1; then
  echo "[build-native] swift not found. Install Xcode Command Line Tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

if [[ ! -f "$BRIDGE_DIR/Package.swift" ]]; then
  echo "[build-native] Missing Swift package at: $BRIDGE_DIR" >&2
  exit 1
fi

echo "[build-native] Building claw-native-bridge (release)…"
(cd "$BRIDGE_DIR" && swift build -c release)

BIN="$BRIDGE_DIR/.build/release/claw-native-bridge"
if [[ ! -x "$BIN" ]]; then
  echo "[build-native] Build completed but binary not found/executable at: $BIN" >&2
  exit 1
fi

echo "[build-native] OK: $BIN"

