#!/usr/bin/env python3
"""Fetch current Garmin Connect daily stats using macOS Keychain and session caching.

Optimizations:
- Exponential backoff on 429/timeouts (starts at 5 minutes, doubles each retry)
- Persist OAuth tokens in macOS Keychain (service="apex", account="garmin_token")
- Stagger startup metric fetches (heart rate, sleep, steps) 30s apart
"""

import json
import os
import subprocess
import sys
from datetime import datetime
import time

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

try:
    import requests
except Exception:  # pragma: no cover
    requests = None

KEYCHAIN_SERVICE = "apex"
KEYCHAIN_ACCOUNT = "garmin_token"

BACKOFF_INITIAL_SECONDS = 5 * 60
BACKOFF_MAX_ATTEMPTS = int(os.getenv("GARMIN_BACKOFF_MAX_ATTEMPTS", "6"))

STARTUP_STAGGER_SECONDS = 30

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

def _security(*args) -> str:
    return subprocess.check_output(["security", *args], stderr=subprocess.DEVNULL).decode().strip()

def get_keychain_token():
    """Fetch cached Garmin OAuth tokens from Keychain."""
    try:
        token = _security("find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w")
        return token if token else None
    except Exception:
        return None

def set_keychain_token(token: str) -> None:
    """Upsert cached Garmin OAuth tokens into Keychain."""
    if not token:
        return
    # -U updates if present
    subprocess.check_call(
        ["security", "add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", token, "-U"],
        stderr=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
    )

def _is_timeout_error(exc: Exception) -> bool:
    if requests is None:
        return False
    return isinstance(exc, requests.exceptions.Timeout)

def _is_rate_limited_error(exc: Exception) -> bool:
    # garth wraps HTTP status failures as GarthHTTPError; the original HTTPError has .response
    status = None
    resp = getattr(getattr(exc, "error", None), "response", None)
    if resp is not None:
        status = getattr(resp, "status_code", None)
    if status == 429:
        return True

    msg = str(exc).lower()
    # Cloudflare / generic rate-limit strings (incl. Garmin Error 1015)
    return ("429" in msg) or ("too many requests" in msg) or ("rate limit" in msg) or ("1015" in msg)

def with_exponential_backoff(fn, *, label: str):
    """Run fn() with exponential backoff on 429/timeouts."""
    backoff = BACKOFF_INITIAL_SECONDS
    attempt = 0
    while True:
        try:
            return fn()
        except Exception as e:
            attempt += 1
            if attempt >= BACKOFF_MAX_ATTEMPTS or not (_is_rate_limited_error(e) or _is_timeout_error(e)):
                raise

            # Sleep first, then retry; double each time.
            print(
                json.dumps(
                    {
                        "warning": "garmin_backoff",
                        "label": label,
                        "attempt": attempt,
                        "sleep_seconds": backoff,
                        "error": str(e),
                    }
                ),
                file=sys.stderr,
            )
            time.sleep(backoff)
            backoff *= 2

def _prime_garmin_client(client: Garmin) -> None:
    # Mirror Garmin.login() side-effects without re-auth
    profile = client.garth.profile
    client.display_name = profile["displayName"]
    client.full_name = profile["fullName"]
    settings = client.garth.connectapi("/userprofile-service/userprofile/user-settings")
    client.unit_system = settings["userData"]["measurementSystem"]

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
        # Prefer Keychain token (survives restarts), then fallback to /tmp tokenstore.
        kc_token = get_keychain_token()
        if kc_token:
            with_exponential_backoff(lambda: client.garth.loads(kc_token), label="garth.loads(keychain)")
            with_exponential_backoff(lambda: _prime_garmin_client(client), label="prime_client")
            return client

        # Try to resume session from tokenstore (best-effort); avoids re-auth spam.
        if os.path.exists(os.path.join(auth_dir, 'oauth2_token.json')):
            with_exponential_backoff(lambda: client.login(auth_dir), label="client.login(tokenstore)")
        else:
            with_exponential_backoff(lambda: client.login(), label="client.login")
            client.garth.dump(dir_path=auth_dir)

        # Persist in Keychain for next run.
        with_exponential_backoff(lambda: set_keychain_token(client.garth.dumps()), label="keychain.persist")
        return client
    except Exception as e:
        # If resume fails, try full login
        try:
            with_exponential_backoff(lambda: client.login(), label="client.login(fallback)")
            client.garth.dump(dir_path=auth_dir)
            with_exponential_backoff(lambda: set_keychain_token(client.garth.dumps()), label="keychain.persist(fallback)")
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

    # Startup batch fetching (staggered): heart rate -> sleep -> steps
    hr_day = _safe(lambda: with_exponential_backoff(lambda: client.get_rhr_day(today), label="get_rhr_day"))
    if hr_day:
        stats['heart_rate'] = {'resting': hr_day.get('restingHeartRate')}

    time.sleep(STARTUP_STAGGER_SECONDS)

    sleep_raw = _safe(lambda: with_exponential_backoff(lambda: client.get_sleep_data(today), label="get_sleep_data"), {})
    dto = sleep_raw.get('dailySleepDTO', {}) if sleep_raw else {}
    if dto:
        stats['sleep'] = {
            'duration_hours': round(dto.get('sleepTimeSeconds', 0) / 3600, 1),
            'sleep_score': dto.get('sleepScores', {}).get('overall', {}).get('value'),
        }

    time.sleep(STARTUP_STAGGER_SECONDS)

    steps_raw = _safe(lambda: with_exponential_backoff(lambda: client.get_steps_data(today), label="get_steps_data"), {})
    if steps_raw:
        # Garmin returns a chart structure; keep it light but useful
        stats['steps'] = {
            'total': steps_raw.get('totalSteps'),
        }

    # Keep existing extras (still protected by backoff).
    bb = _safe(lambda: with_exponential_backoff(lambda: client.get_body_battery(today), label="get_body_battery"), [])
    if bb:
        stats['body_battery'] = {'current': bb[-1].get('value', 0) if bb else 0}

    ts = _safe(lambda: with_exponential_backoff(lambda: client.get_training_status(cdate=today), label="get_training_status"))
    if ts:
        stats['training_status'] = {'status': ts.get('mostRecentTrainingStatus', {}).get('status')}

    print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()
