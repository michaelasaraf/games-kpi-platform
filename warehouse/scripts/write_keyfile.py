"""Writes the service account key from GCP_SA_KEY_JSON to a file for dbt.

Accepts the JSON itself (one line or several, optionally quoted) or the key file base64-encoded,
because some env editors only take one KEY=value line. Usage: python scripts/write_keyfile.py PATH
"""
import base64
import json
import os
import sys


def parse_key(text: str) -> dict:
    t = text.strip()
    if len(t) >= 2 and t[0] in "'\"" and t[-1] == t[0]:
        t = t[1:-1].strip()
    if not t.startswith("{"):
        t = base64.b64decode(t).decode("utf-8").strip()
    key = json.loads(t)
    if "client_email" not in key or "private_key" not in key:
        raise ValueError("GCP_SA_KEY_JSON is not a service account key")
    return key


def main() -> None:
    path = sys.argv[1]
    key = parse_key(os.environ["GCP_SA_KEY_JSON"])
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(key, f)


if __name__ == "__main__":
    main()
