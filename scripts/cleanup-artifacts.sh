#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "==> Deleting ./releases/"
rm -rf "$ROOT/releases"
echo "==> Swift package clean: ./claw-native-bridge/"
if [[ -d "$ROOT/claw-native-bridge" ]]; then
  (cd "$ROOT/claw-native-bridge" && swift package clean)
else
  echo "   (skipped: claw-native-bridge/ not found)"
fi
echo "==> Cleaning ./dist/"
rm -rf "$ROOT/dist"
echo "==> Done."
