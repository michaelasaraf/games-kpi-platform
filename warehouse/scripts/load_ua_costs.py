"""Loads user acquisition (UA) spend into BigQuery before the dbt build: Meta (Facebook) Ads.

One row per ad account, day, ad set and country, from the Meta Marketing API insights endpoint, with
the spend converted to USD. Each ad set also carries the app it promotes (the store link of an app
install campaign), so dbt can match the spend to a game and platform; see models/marts/kpi_ua_spend.sql.

  Meta Ads   Needs META_ACCESS_TOKEN (a system user token with ads_read) and META_AD_ACCOUNT_IDS
             (comma separated, with or without the act_ prefix). See docs/setup.md, "UA spend from Meta Ads".
             Optional: META_API_VERSION (default below).

Days follow each ad account's time zone. The first run loads the last META_BACKFILL_DAYS days (365);
later runs reload the last 7, because Meta keeps adding installs to a day for its attribution window.

A missing setting skips the source. A failure is reported and the build goes on with the last good load.

Usage: python scripts/load_ua_costs.py   (needs GCP_PROJECT and GCP_KEYFILE, like dbt)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import time
import traceback
from urllib.parse import parse_qs, urlparse

import requests
from google.cloud import bigquery
from google.oauth2 import service_account

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load_revenue import Fx, ensure_table, replace_rows  # noqa: E402

META_TABLE = "src_meta_ads_daily"
META_API_VERSION = os.environ.get("META_API_VERSION", "v24.0")
META_API = f"https://graph.facebook.com/{META_API_VERSION}"
BACKFILL_DAYS = int(os.environ.get("META_BACKFILL_DAYS", "365"))
LOOKBACK_DAYS = 7
CHUNK_DAYS = 30  # one insights request per 30 days keeps each response small
# Install actions, best first: the app install event Meta counts for app promotion campaigns.
INSTALL_ACTIONS = ("mobile_app_install", "omni_app_install", "app_install")
ADSET_STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS",
                  "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"]

META_SCHEMA = [
    bigquery.SchemaField("report_date", "DATE", description="in the ad account's time zone"),
    bigquery.SchemaField("account_id", "STRING"),
    bigquery.SchemaField("account_currency", "STRING"),
    bigquery.SchemaField("campaign_id", "STRING"),
    bigquery.SchemaField("campaign_name", "STRING"),
    bigquery.SchemaField("adset_id", "STRING"),
    bigquery.SchemaField("adset_name", "STRING"),
    bigquery.SchemaField("country_code", "STRING"),
    bigquery.SchemaField("store_url", "STRING", description="promoted_object.object_store_url of the ad set"),
    bigquery.SchemaField("app_store_id", "STRING", description="package name (Google Play) or numeric id (App Store) from store_url"),
    bigquery.SchemaField("platform", "STRING", description="android | ios, from store_url; null when the ad set promotes no app"),
    bigquery.SchemaField("meta_app_id", "STRING", description="promoted_object.application_id (Meta app id)"),
    bigquery.SchemaField("spend", "FLOAT", description="in account_currency"),
    bigquery.SchemaField("usd_rate", "FLOAT", description="units of account_currency per USD on the day"),
    bigquery.SchemaField("spend_usd", "FLOAT"),
    bigquery.SchemaField("impressions", "INTEGER"),
    bigquery.SchemaField("clicks", "INTEGER"),
    bigquery.SchemaField("installs", "INTEGER", description="app installs Meta attributes to the ad set (its attribution setting)"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]


def log(msg: str) -> None:
    print(f"[load_ua_costs] {msg}", flush=True)


# --- Meta Marketing API ---------------------------------------------------------------------


class Meta:
    def __init__(self, token: str) -> None:
        self.s = requests.Session()
        self.token = token

    def get(self, url: str, params: dict | None = None) -> dict:
        """GET with the token, retrying Meta's rate limit and transient errors."""
        params = dict(params or {})
        if not url.startswith("http"):
            url = f"{META_API}/{url}"
            params["access_token"] = self.token
        for attempt in range(6):
            r = self.s.get(url, params=params, timeout=120)
            if r.status_code == 200:
                return r.json()
            err = {}
            try:
                err = r.json().get("error", {})
            except ValueError:
                pass
            code = err.get("code")
            # 4, 17, 32, 613, 80000-80014: rate limits; 1, 2: temporary errors.
            if code in (1, 2, 4, 17, 32, 613) or (isinstance(code, int) and 80000 <= code <= 80014) or r.status_code >= 500:
                wait = min(300, 15 * 2 ** attempt)
                log(f"meta: {err.get('message', r.status_code)} (code {code}), retrying in {wait}s")
                time.sleep(wait)
                continue
            raise RuntimeError(f"Meta API {r.status_code}: {err.get('message') or r.text[:300]} (code {code})")
        raise RuntimeError("Meta API: still rate limited after 6 tries")

    def pages(self, path: str, params: dict):
        body = self.get(path, params)
        while True:
            yield from body.get("data", [])
            nxt = body.get("paging", {}).get("next")
            if not nxt:
                return
            body = self.get(nxt)  # the next link already carries the token and params


def parse_store_url(url: str | None) -> tuple[str | None, str | None]:
    """(app_store_id, platform) from a Google Play or App Store link."""
    if not url:
        return None, None
    u = urlparse(url)
    host = u.netloc.lower()
    if "play.google.com" in host:
        pkg = parse_qs(u.query).get("id", [None])[0]
        return pkg, "android"
    if "apple.com" in host or "itunes" in host:
        m = re.search(r"id(\d+)", u.path)
        return (m.group(1) if m else None), "ios"
    return None, None


def adset_apps(meta: Meta, account: str) -> dict[str, dict]:
    """promoted_object of every ad set in the account (deleted and archived ones too)."""
    out = {}
    params = {
        "fields": "id,promoted_object",
        "limit": 500,
        "filtering": json.dumps([{"field": "effective_status", "operator": "IN", "value": ADSET_STATUSES}]),
    }
    for a in meta.pages(f"{account}/adsets", params):
        out[a["id"]] = a.get("promoted_object") or {}
    return out


def installs(actions: list[dict] | None) -> int:
    by_type = {a.get("action_type"): a.get("value") for a in actions or []}
    for t in INSTALL_ACTIONS:
        if by_type.get(t) is not None:
            return int(float(by_type[t]))
    return 0


def account_id(raw: str) -> str:
    raw = raw.strip()
    return raw if raw.startswith("act_") else f"act_{raw}"


def load_account(meta: Meta, account: str, start: dt.date, end: dt.date, fx: Fx, now: str) -> list[dict]:
    apps = adset_apps(meta, account)
    rows = []
    since = start
    while since <= end:
        until = min(end, since + dt.timedelta(days=CHUNK_DAYS - 1))
        params = {
            "level": "adset",
            "time_increment": 1,
            "breakdowns": "country",
            "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
            "fields": "account_id,account_currency,campaign_id,campaign_name,adset_id,adset_name,"
                      "spend,impressions,clicks,actions",
            "limit": 500,
        }
        for r in meta.pages(f"{account}/insights", params):
            adset = r.get("adset_id")
            if adset not in apps:  # an ad set the list missed: ask for it directly
                try:
                    apps[adset] = meta.get(adset, {"fields": "promoted_object"}).get("promoted_object") or {}
                except RuntimeError:
                    apps[adset] = {}
            po = apps[adset]
            store_url = po.get("object_store_url")
            store_id, platform = parse_store_url(store_url)
            day = dt.date.fromisoformat(r["date_start"])
            currency = r.get("account_currency") or "USD"
            spend = float(r.get("spend") or 0)
            rate = fx.per_usd(currency, day)
            rows.append({
                "report_date": day.isoformat(),
                "account_id": r.get("account_id"),
                "account_currency": currency,
                "campaign_id": r.get("campaign_id"),
                "campaign_name": r.get("campaign_name"),
                "adset_id": adset,
                "adset_name": r.get("adset_name"),
                "country_code": (r.get("country") or "").upper() or None,
                "store_url": store_url,
                "app_store_id": store_id,
                "platform": platform,
                "meta_app_id": str(po["application_id"]) if po.get("application_id") else None,
                "spend": spend,
                "usd_rate": rate,
                "spend_usd": spend / rate if rate else None,
                "impressions": int(r.get("impressions") or 0),
                "clicks": int(r.get("clicks") or 0),
                "installs": installs(r.get("actions")),
                "loaded_at": now,
            })
        since = until + dt.timedelta(days=1)
    missing = sum(1 for x in rows if x["spend_usd"] is None and x["spend"])
    if missing:
        log(f"meta {account}: {missing} rows have no USD rate; their spend counts as 0")
    return rows


def load_meta(bq: bigquery.Client, dataset: str) -> None:
    table_id = ensure_table(bq, dataset, META_TABLE, META_SCHEMA, "report_date")
    meta = Meta(os.environ["META_ACCESS_TOKEN"])
    fx = Fx()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    end = dt.date.today()
    for account in [account_id(a) for a in os.environ["META_AD_ACCOUNT_IDS"].split(",") if a.strip()]:
        loaded = [x.d for x in bq.query(
            f"select max(report_date) as d from `{table_id}` where account_id = @a",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("a", "STRING", account.removeprefix("act_"))])).result()][0]
        start = end - dt.timedelta(days=LOOKBACK_DAYS if loaded else BACKFILL_DAYS)
        rows = load_account(meta, account, start, end, fx, now)
        replace_rows(bq, table_id, META_SCHEMA, "account_id = @a and report_date between @s and @e", [
            bigquery.ScalarQueryParameter("a", "STRING", account.removeprefix("act_")),
            bigquery.ScalarQueryParameter("s", "DATE", start),
            bigquery.ScalarQueryParameter("e", "DATE", end),
        ], rows)
        spend = sum(x["spend_usd"] or 0 for x in rows)
        unmatched = sum(x["spend_usd"] or 0 for x in rows if not x["app_store_id"])
        log(f"meta {account} {start}..{end}: {len(rows)} rows, ${spend:,.2f} spend"
            + (f" (${unmatched:,.2f} on ad sets that promote no app store link)" if unmatched else ""))


# --- main -----------------------------------------------------------------------------------


def main() -> int:
    project = os.environ["GCP_PROJECT"]
    dataset = os.environ.get("BQ_DATASET", "games_kpi")
    location = os.environ.get("BQ_LOCATION", "US")
    keyfile = os.environ.get("GCP_KEYFILE", "/tmp/gcp-sa.json")
    creds = service_account.Credentials.from_service_account_file(
        keyfile, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    bq = bigquery.Client(project=project, credentials=creds, location=location)
    bq.create_dataset(bigquery.Dataset(f"{project}.{dataset}"), exists_ok=True)
    # The table always exists, so the dbt models compile before Meta is set up.
    ensure_table(bq, dataset, META_TABLE, META_SCHEMA, "report_date")

    if not (os.environ.get("META_ACCESS_TOKEN") and os.environ.get("META_AD_ACCOUNT_IDS")):
        log("meta: skipped, META_ACCESS_TOKEN / META_AD_ACCOUNT_IDS are not set")
        return 0
    try:
        load_meta(bq, dataset)
    except Exception:  # noqa: BLE001 - keep the build going, report loudly
        log("meta: FAILED\n" + traceback.format_exc())
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
