"""Offline test of the Meta referrer decryption (no BigQuery): python scripts/test_meta_referrers.py"""
import json
import os
import sys
from urllib.parse import quote

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load_meta_referrers import decrypt, parse_keys  # noqa: E402

KEY = bytes(range(32))
OTHER = bytes(range(1, 33))
NONCE = bytes(12)
PAYLOAD = {"ad_id": 6110000000001, "adgroup_id": "6110000000002", "campaign_id": "6110000000003",
           "campaign_group_id": "6110000000004", "campaign_name": "Gem Mine US", "account_id": "56624252",
           "ad_objective_name": "APP_INSTALLS"}


def content(payload: dict, key: bytes = KEY, app: int = 111) -> str:
    data = AESGCM(key).encrypt(NONCE, json.dumps(payload).encode(), None)  # ciphertext + 16-byte tag
    return json.dumps({"app": app, "t": 1762900000, "source": {"data": data.hex(), "nonce": NONCE.hex()}})


def main() -> int:
    keys = parse_keys(f"111:{KEY.hex()}x, 222:{OTHER.hex()}")
    assert keys == [("111", KEY), ("222", OTHER)], keys

    r = decrypt(content(PAYLOAD), keys)
    assert r["decrypted"] and r["error"] is None, r
    assert r["ad_id"] == "6110000000001" and r["campaign_group_id"] == "6110000000004", r
    assert r["meta_app_id"] == "111" and r["adgroup_name"] is None, r

    # Still URL-encoded, as some referrer readers hand it over.
    assert decrypt(quote(content(PAYLOAD)), keys)["decrypted"]
    # An app id we have no key for: every key is tried.
    assert decrypt(content(PAYLOAD, OTHER, app=999), keys)["decrypted"]
    # A key without an app id.
    assert decrypt(content(PAYLOAD), parse_keys(KEY.hex()))["decrypted"]
    # Wrong key, no key, not a Meta referrer.
    assert decrypt(content(PAYLOAD, OTHER), [("111", KEY)])["error"] == "no key fits (wrong app or key)"
    assert decrypt(content(PAYLOAD), [])["error"] == "no key (set META_REFERRER_KEYS)"
    assert decrypt('{"app":1}', keys)["error"].startswith("not a Meta referrer")
    assert decrypt("", keys)["error"].startswith("not a Meta referrer")
    print("meta referrer tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
