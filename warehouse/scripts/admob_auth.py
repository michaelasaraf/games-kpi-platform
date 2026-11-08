"""One-time AdMob sign-in: turns your approval into the ADMOB_REFRESH_TOKEN the hourly job uses.

The AdMob API does not accept service accounts, so the job reads AdMob as you, read-only.

  1. python scripts/admob_auth.py url  CLIENT_ID
     Open the printed link, sign in with the Google account that owns AdMob and allow access.
     The browser then goes to http://localhost/?code=... and shows "can't connect": that is
     expected. Copy that whole address from the address bar.
  2. python scripts/admob_auth.py token CLIENT_ID CLIENT_SECRET 'http://localhost/?code=...'
     Prints the refresh token. Put it in ADMOB_REFRESH_TOKEN, with ADMOB_CLIENT_ID and
     ADMOB_CLIENT_SECRET, on the kpi-models service.
"""
import sys
import urllib.parse

import requests

SCOPE = "https://www.googleapis.com/auth/admob.readonly"
REDIRECT = "http://localhost"


def auth_url(client_id: str) -> str:
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    })


def exchange(client_id: str, client_secret: str, pasted: str) -> str:
    code = pasted.strip()
    if code.startswith("http"):
        code = urllib.parse.parse_qs(urllib.parse.urlparse(code).query)["code"][0]
    r = requests.post("https://oauth2.googleapis.com/token", timeout=30, data={
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT,
        "grant_type": "authorization_code",
    })
    r.raise_for_status()
    token = r.json().get("refresh_token")
    if not token:
        raise SystemExit("No refresh token in the answer: run step 1 again (it asks for consent each time).")
    return token


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "url":
        print(auth_url(sys.argv[2]))
    elif len(sys.argv) == 5 and sys.argv[1] == "token":
        print(exchange(sys.argv[2], sys.argv[3], sys.argv[4]))
    else:
        raise SystemExit(__doc__)
