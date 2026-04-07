#!/usr/bin/env python3
"""Fetch current Garmin Connect daily stats using macOS Keychain and Session Caching."""

import json
import os
import subprocess
import sys
from datetime import datetime

# Adjust path to include venv site-packages if needed
# (Assuming standard venv structure)
script_dir = os.path.dirname(os.path.abspath(__file__))
venv_path = os.path.join(script_dir, '..', 'venv', 'lib')
if os.path.exists(venv_path):
    py_ver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    site_packages = os.path.join(venv_path, py_ver, 'site-packages')
    sys.path.insert(0, site_packages)

try:
    from garminconnect import Garmin, GarminConnectAuthenticationError
except ImportError:
    print(json.dumps({"error": "garminconnect not installed. Run: pip install garminconnect"}), file=sys.stderr)
    sys.exit(1)

def get_keychain_credentials():
    """Fetch credentials from macOS Keychain."""
    try:
        # Fetch email (account name)
        email_out = subprocess.check_output(['security', 'find-generic-password', '-s', 'GarminConnect'], stderr=subprocess.DEVNULL).decode()
        email = None
        for line in email_out.split('\n'):
            if '"acct"<blob>="' in line:
                email = line.split('"')[3]
                break
        
        # Fetch password
        password = subprocess.check_output(['security', 'find-generic-password', '-s', 'GarminConnect', '-w'], stderr=subprocess.DEVNULL).decode().strip()
        
        return email, password
    except Exception:
        return None, None

def get_garmin_client():
    """Authenticate with Garmin Connect with session caching."""
    auth_dir = '/tmp/garmin-session/'
    os.makedirs(auth_dir, exist_ok=True)

    email, password = get_keychain_credentials()
    if not email or not password:
        print(json.dumps({"error": "Credentials not found in Keychain. Run security add-generic-password command."}), file=sys.stderr)
        sys.exit(1)

    client = Garmin(email, password)
    
    try:
        # Try to resume session first to avoid 429
        if os.path.exists(os.path.join(auth_dir, 'oauth2_token.json')):
            client.login(auth_dir)
        else:
            client.login()
            client.garth.dump(dir_path=auth_dir)
        return client
    except Exception as e:
        # If resume fails, try full login
        try:
            client.login()
            client.garth.dump(dir_path=auth_dir)
            return client
        except Exception as e2:
            print(json.dumps({"error": f"Login failed: {e2}"}), file=sys.stderr)
            sys.exit(1)

def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default

def main():
    client = get_garmin_client()
    today = datetime.now().strftime('%Y-%m-%d')
    stats = {}

    stats['name'] = _safe(lambda: client.get_full_name())

    # Sleep
    sleep_raw = _safe(lambda: client.get_sleep_data(today), {})
    dto = sleep_raw.get('dailySleepDTO', {}) if sleep_raw else {}
    if dto:
        stats['sleep'] = {
            'duration_hours': round(dto.get('sleepTimeSeconds', 0) / 3600, 1),
            'sleep_score': dto.get('sleepScores', {}).get('overall', {}).get('value'),
        }

    # Body Battery
    bb = _safe(lambda: client.get_body_battery(today), [])
    if bb:
        stats['body_battery'] = {
            'current': bb[-1].get('value', 0) if bb else 0,
        }

    # Resting Heart Rate
    hr = _safe(lambda: client.get_rhr_day(today))
    if hr:
        stats['heart_rate'] = {'resting': hr.get('restingHeartRate')}

    # Training Status
    ts = _safe(lambda: client.get_training_status(cdate=today))
    if ts:
        stats['training_status'] = {
            'status': ts.get('mostRecentTrainingStatus', {}).get('status'),
        }

    print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()
