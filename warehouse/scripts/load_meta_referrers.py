"""Decrypts Meta's install referrers into BigQuery before the dbt build: which Meta campaign, ad set
and ad brought each player.

Meta adds encrypted campaign data to the Google Play install referrer of every click-through install
from its ads (utm_content = {"app": <Meta app id>, "source": {"data": <hex>, "nonce": <hex>}}).
Firebase drops that value (longer than its 100-character limit), so the games-kpi wrappers send it
themselves as the meta_install_referrer event, cut into 100-character params p00, p01, ... (parts =
how many). This step joins the parts back, decrypts them with the Meta app's Install Referrer
Decryption Key (AES-256-GCM) and writes one row per event to src_meta_install_referrers.
dbt (clean/player_meta_ad) keeps each player's first one and matches it to src_meta_ads.

  Needs META_REFERRER_KEYS: the key of each Meta app, from the Meta App Dashboard (App settings >
  Basic > Android > Install Referrer Decryption Key, 64 hex characters), as
  <meta app id>:<key>[,<meta app id>:<key>...]. A key without an app id is tried on every referrer.

Without keys the referrers are still stored (decrypted = false), and decrypted once a key is set:
each run reloads from the oldest undecrypted day, or else the last LOOKBACK_DAYS days.

Usage: python scripts/load_meta_referrers.py   (needs GCP_PROJECT and GCP_KEYFILE, like dbt)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
import traceback
from urllib.parse import unquote

import yaml
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from google.cloud import bigquery
from google.oauth2 import service_account

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load_revenue import ensure_table, replace_rows  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = "src_meta_install_referrers"
EVENT = "meta_install_referrer"
LOOKBACK_DAYS = 4  # Firebase keeps adding late events to a day's export for up to 72 hours.
FIRST_DAY = dt.date(2026, 11, 1)  # no game sent the event before this

SCHEMA = [
    bigquery.SchemaField("game_id", "STRING"),
    bigquery.SchemaField("player_id", "STRING", description="user_pseudo_id, like clean_events.player_id"),
    bigquery.SchemaField("event_date", "DATE", description="UTC day of event_ts"),
    bigquery.SchemaField("event_ts", "TIMESTAMP"),
    bigquery.SchemaField("platform", "STRING"),
    bigquery.SchemaField("origin", "STRING", description="where the wrapper read it: play (Google Play install referrer)"),
    bigquery.SchemaField("meta_app_id", "STRING", description="utm_content.app"),
    bigquery.SchemaField("decrypted", "BOOLEAN"),
    bigquery.SchemaField("error", "STRING", description="why it was not decrypted"),
    bigquery.SchemaField("ad_id", "STRING"),
    bigquery.SchemaField("adgroup_id", "STRING"),
    bigquery.SchemaField("adgroup_name", "STRING"),
    bigquery.SchemaField("campaign_id", "STRING"),
    bigquery.SchemaField("campaign_name", "STRING"),
    bigquery.SchemaField("campaign_group_id", "STRING"),
    bigquery.SchemaField("campaign_group_name", "STRING"),
    bigquery.SchemaField("account_id", "STRING"),
    bigquery.SchemaField("ad_objective_name", "STRING"),
    bigquery.SchemaField("publisher_platform", "STRING"),
    bigquery.SchemaField("payload", "STRING", description="the decrypted JSON, as Meta sent it"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]

FIELDS = ("ad_id", "adgroup_id", "adgroup_name", "campaign_id", "campaign_name", "campaign_group_id",
          "campaign_group_name", "account_id", "ad_objective_name", "publisher_platform")


def log(msg: str) -> None:
    print(f"[load_meta_referrers] {msg}", flush=True)


def configured_games() -> list[dict]:
    return yaml.safe_load((ROOT / "dbt_project.yml").read_text())["vars"]["games"]


def parse_keys(text: str) -> list[tuple[str | None, bytes]]:
    """[(meta app id or None, 32-byte key)] from META_REFERRER_KEYS."""
    keys = []
    for item in text.split(","):
        item = item.strip()
        if not item:
            continue
        app, _, key = item.rpartition(":")
        key = key.strip()[:64]  # the dashboard sometimes shows a stray character after the 64 hex digits
        keys.append((app.strip() or None, bytes.fromhex(key)))
    return keys


def decrypt(content: str, keys: list[tuple[str | None, bytes]]) -> dict:
    """Decrypts one utm_content value. Returns the row fields (decrypted, error, ids, payload)."""
    out: dict = {"decrypted": False, "error": None, "meta_app_id": None, "payload": None}
    out.update({f: None for f in FIELDS})
    text = content.strip()
    if text.startswith("%7B") or text.startswith("%7b"):  # still URL-encoded
        text = unquote(text)
    try:
        outer = json.loads(text)
        source = outer["source"]
        data = bytes.fromhex(source["data"])
        nonce = bytes.fromhex(source["nonce"])
    except (ValueError, KeyError, TypeError) as e:
        out["error"] = f"not a Meta referrer: {type(e).__name__}"
        return out
    app = outer.get("app")
    out["meta_app_id"] = str(app) if app is not None else None
    candidates = [k for a, k in keys if a == out["meta_app_id"]] + [k for a, k in keys if a is None]
    if not candidates:
        candidates = [k for _, k in keys]  # an app id we were not told about: try every key
    if not candidates:
        out["error"] = "no key (set META_REFERRER_KEYS)"
        return out
    for key in candidates:
        try:
            plain = AESGCM(key).decrypt(nonce, data, None)
        except Exception:  # noqa: BLE001 - wrong key or damaged data: try the next key
            continue
        try:
            payload = json.loads(plain.decode("utf-8"))
        except ValueError:
            out["error"] = "decrypted, but not JSON"
            return out
        out["decrypted"] = True
        out["payload"] = json.dumps(payload, separators=(",", ":"))
        for f in FIELDS:
            v = payload.get(f)
            out[f] = None if v is None else str(v)
        return out
    out["error"] = "no key fits (wrong app or key)"
    return out


def read_events(bq: bigquery.Client, g: dict, start: dt.date) -> list[dict]:
    sql = f"""
      select
        user_pseudo_id as player_id,
        timestamp_micros(event_timestamp) as event_ts,
        lower(platform) as platform,
        (select value.string_value from unnest(event_params) where key = 'origin') as origin,
        (select value.int_value from unnest(event_params) where key = 'parts') as parts,
        array_to_string(array(
          select value.string_value from unnest(event_params)
          where regexp_contains(key, r'^p[0-9][0-9]$') order by key), '') as content
      from `{g['firebase_project']}.{g['analytics_dataset']}.events_*`
      where _TABLE_SUFFIX >= @s  -- 'intraday_...' sorts after every date, so today's tables are in
        and event_name = '{EVENT}'
        and user_pseudo_id is not null
    """
    cfg = bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("s", "STRING", start.strftime("%Y%m%d"))])
    return [dict(r) for r in bq.query(sql, job_config=cfg).result()]


def start_day(bq: bigquery.Client, table_id: str, game_id: str) -> dt.date:
    row = list(bq.query(
        f"""select max(event_date) as last, min(if(decrypted, null, event_date)) as undecrypted
            from `{table_id}` where game_id = @g""",
        job_config=bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("g", "STRING", game_id)]),
    ).result())[0]
    if row.last is None:
        return FIRST_DAY
    start = dt.date.today() - dt.timedelta(days=LOOKBACK_DAYS)
    return min(start, row.undecrypted) if row.undecrypted else start


def load(bq: bigquery.Client, dataset: str, keys: list[tuple[str | None, bytes]]) -> bool:
    table_id = ensure_table(bq, dataset, TABLE, SCHEMA, "event_date")
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    failed = False
    for g in configured_games():
        if not (g.get("firebase_project") and g.get("analytics_dataset")):
            continue
        try:
            start = start_day(bq, table_id, g["game_id"])
            rows = []
            for e in read_events(bq, g, start):
                ts = e["event_ts"]
                rows.append({
                    "game_id": g["game_id"],
                    "player_id": e["player_id"],
                    "event_date": ts.date().isoformat(),
                    "event_ts": ts.isoformat(),
                    "platform": e["platform"],
                    "origin": e["origin"],
                    **decrypt(e["content"] or "", keys),
                    "loaded_at": now,
                })
            replace_rows(bq, table_id, SCHEMA, "game_id = @g and event_date >= @s", [
                bigquery.ScalarQueryParameter("g", "STRING", g["game_id"]),
                bigquery.ScalarQueryParameter("s", "DATE", start),
            ], rows)
            ok = sum(1 for r in rows if r["decrypted"])
            errors = sorted({r["error"] for r in rows if r["error"]})
            log(f"{g['game_id']} since {start}: {len(rows)} referrers, {ok} decrypted"
                + (f"; not decrypted: {', '.join(errors)}" if errors else ""))
        except Exception:  # noqa: BLE001 - one game must not stop the others
            failed = True
            log(f"{g['game_id']}: FAILED\n" + traceback.format_exc())
    return not failed


def main() -> int:
    project = os.environ["GCP_PROJECT"]
    dataset = os.environ.get("BQ_DATASET", "games_kpi")
    location = os.environ.get("BQ_LOCATION", "US")
    keyfile = os.environ.get("GCP_KEYFILE", "/tmp/gcp-sa.json")
    creds = service_account.Credentials.from_service_account_file(
        keyfile, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    bq = bigquery.Client(project=project, credentials=creds, location=location)
    bq.create_dataset(bigquery.Dataset(f"{project}.{dataset}"), exists_ok=True)
    # The table always exists, so the dbt models compile before any game sends the event.
    ensure_table(bq, dataset, TABLE, SCHEMA, "event_date")
    try:
        keys = parse_keys(os.environ.get("META_REFERRER_KEYS", ""))
    except ValueError:
        log("META_REFERRER_KEYS is not <meta app id>:<64 hex characters>[,...]; storing referrers undecrypted")
        keys = []
    if not keys:
        log("no META_REFERRER_KEYS: referrers are stored and decrypted once a key is set")
    return 0 if load(bq, dataset, keys) else 1


if __name__ == "__main__":
    sys.exit(main())
