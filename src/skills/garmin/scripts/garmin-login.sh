#!/bin/bash
# Garmin Connect authentication using macOS Keychain
#
# Usage: 
# 1. Run this once to store credentials:
#    security add-generic-password -a "YOUR_GARMIN_EMAIL" -s "GarminConnect" -w "YOUR_GARMIN_PASSWORD" -U
# 2. Run this script to test login.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../venv/bin/activate" ]; then
  source "$SCRIPT_DIR/../venv/bin/activate"
fi

# Fetch from Keychain
# We search for account (-a) and service (-s)
# Note: This might pop a macOS dialog asking for permission to access the Keychain.
EMAIL=$(security find-generic-password -s "GarminConnect" | grep "acct" | cut -d "\"" -f 4 || echo "")
PASSWORD=$(security find-generic-password -s "GarminConnect" -w || echo "")

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "❌ Credentials not found in macOS Keychain."
  echo "   Please run this command first:"
  echo "   security add-generic-password -a \"YOUR_EMAIL\" -s \"GarminConnect\" -w \"YOUR_PASSWORD\" -U"
  exit 1
fi

mkdir -p /tmp/garmin-session

python3 - <<PYEOF
import sys, os
os.environ['GARMIN_EMAIL'] = "$EMAIL"
os.environ['GARMIN_PASSWORD'] = "$PASSWORD"

try:
    from garminconnect import Garmin
    client = Garmin(os.environ['GARMIN_EMAIL'], os.environ['GARMIN_PASSWORD'])
    client.login()
    client.garth.dump(dir_path='/tmp/garmin-session/')
    print(f"✅ Logged in as: {client.get_full_name()}")
except ImportError:
    print("❌ garminconnect not installed — pip install garminconnect")
    sys.exit(1)
except Exception as e:
    print(f"❌ Login failed: {e}")
    sys.exit(1)
PYEOF
