"""Loads user acquisition (UA) spend into BigQuery before the dbt build: Meta (Facebook) Ads.

src_meta_ads_daily: one row per ad account, day, ad and country, from the Meta Marketing API insights
endpoint, with the spend converted to USD and Meta's own count of installs and purchases. Each row also
carries the app its ad set promotes (the store link of an app install campaign), so dbt can match the
spend to a game and platform; see models/marts/kpi_ua_spend.sql.

src_meta_ads: one row per ad (all statuses) with its ad set, campaign and creative (name, thumbnail,
title, body), rewritten on every run. Names and thumbnails for the dashboard's ad rows.

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
# Purchase actions, best first: in-app purchases logged by the Meta SDK (or sent to Meta) for the app.
PURCHASE_ACTIONS = ("omni_purchase", "app_custom_event.fb_mobile_purchase", "mobile_app_purchase", "purchase")
ADS_TABLE = "src_meta_ads"
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
    bigquery.SchemaField("installs", "INTEGER", description="app installs Meta attributes to the ad (its attribution setting)"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
    # Added with ad-level rows (rows loaded before that have no ad_id and are reloaded on the next run).
    bigquery.SchemaField("ad_id", "STRING"),
    bigquery.SchemaField("ad_name", "STRING"),
    bigquery.SchemaField("purchases", "INTEGER", description="in-app purchases Meta attributes to the ad"),
    bigquery.SchemaField("purchase_value", "FLOAT", description="their value in account_currency, as Meta reports it"),
    bigquery.SchemaField("purchase_value_usd", "FLOAT"),
]

ADS_SCHEMA = [
    bigquery.SchemaField("account_id", "STRING"),
    bigquery.SchemaField("ad_id", "STRING"),
    bigquery.SchemaField("ad_name", "STRING"),
    bigquery.SchemaField("adset_id", "STRING"),
    bigquery.SchemaField("campaign_id", "STRING"),
    bigquery.SchemaField("effective_status", "STRING"),
    bigquery.SchemaField("created_time", "TIMESTAMP"),
    bigquery.SchemaField("creative_id", "STRING"),
    bigquery.SchemaField("creative_name", "STRING"),
    bigquery.SchemaField("thumbnail_url", "STRING", description="signed Meta CDN link; it expires, so it is reloaded every run"),
    bigquery.SchemaField("title", "STRING"),
    bigquery.SchemaField("body", "STRING"),
    bigquery.SchemaField("video_id", "STRING"),
    bigquery.SchemaField("object_type", "STRING"),
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


def first_action(actions: list[dict] | None, types: tuple[str, ...]) -> float:
    """The value of the first action type in `types` that Meta reports (0 when none)."""
    by_type = {a.get("action_type"): a.get("value") for a in actions or []}
    for t in types:
        if by_type.get(t) is not None:
            return float(by_type[t])
    return 0.0


def installs(actions: list[dict] | None) -> int:
    return int(first_action(actions, INSTALL_ACTIONS))


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
            "level": "ad",
            "time_increment": 1,
            "breakdowns": "country",
            "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()}),
            "fields": "account_id,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,"
                      "spend,impressions,clicks,actions,action_values",
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
            purchase_value = first_action(r.get("action_values"), PURCHASE_ACTIONS)
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
                "ad_id": r.get("ad_id"),
                "ad_name": r.get("ad_name"),
                "purchases": int(first_action(r.get("actions"), PURCHASE_ACTIONS)),
                "purchase_value": purchase_value,
                "purchase_value_usd": purchase_value / rate if rate else None,
            })
        since = until + dt.timedelta(days=1)
    missing = sum(1 for x in rows if x["spend_usd"] is None and x["spend"])
    if missing:
        log(f"meta {account}: {missing} rows have no USD rate; their spend counts as 0")
    return rows


def add_missing_columns(bq: bigquery.Client, table_id: str, schema) -> None:
    """Adds schema fields the table does not have yet (new columns are nullable)."""
    table = bq.get_table(table_id)
    have = {f.name for f in table.schema}
    extra = [f for f in schema if f.name not in have]
    if extra:
        table.schema = list(table.schema) + extra
        bq.update_table(table, ["schema"])
        log(f"{table_id}: added columns {', '.join(f.name for f in extra)}")


def meta_time(value: str | None) -> str | None:
    """Meta's 2026-06-15T10:00:00+0000 as ISO 8601 that BigQuery loads."""
    if not value:
        return None
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z").isoformat()
    except ValueError:
        return None


def ad_rows(meta: Meta, account: str, now: str) -> list[dict]:
    """Every ad of the account with its creative."""
    params = {
        "fields": "id,name,adset_id,campaign_id,effective_status,created_time,"
                  "creative{id,name,thumbnail_url,title,body,video_id,object_type}",
        "limit": 200,
        "thumbnail_width": 128,
        "thumbnail_height": 128,
        "filtering": json.dumps([{"field": "effective_status", "operator": "IN", "value": ADSET_STATUSES}]),
    }
    rows = []
    for a in meta.pages(f"{account}/ads", params):
        c = a.get("creative") or {}
        rows.append({
            "account_id": account.removeprefix("act_"),
            "ad_id": a.get("id"),
            "ad_name": a.get("name"),
            "adset_id": a.get("adset_id"),
            "campaign_id": a.get("campaign_id"),
            "effective_status": a.get("effective_status"),
            "created_time": meta_time(a.get("created_time")),
            "creative_id": c.get("id"),
            "creative_name": c.get("name"),
            "thumbnail_url": c.get("thumbnail_url"),
            "title": c.get("title"),
            "body": c.get("body"),
            "video_id": c.get("video_id"),
            "object_type": c.get("object_type"),
            "loaded_at": now,
        })
    return rows


def load_meta(bq: bigquery.Client, dataset: str) -> None:
    table_id = ensure_table(bq, dataset, META_TABLE, META_SCHEMA, "report_date")
    add_missing_columns(bq, table_id, META_SCHEMA)
    ads_id = ensure_table(bq, dataset, ADS_TABLE, ADS_SCHEMA, None)
    meta = Meta(os.environ["META_ACCESS_TOKEN"])
    fx = Fx()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    end = dt.date.today()
    for account in [account_id(a) for a in os.environ["META_AD_ACCOUNT_IDS"].split(",") if a.strip()]:
        # Rows from before ad-level loading have no ad_id: reload the whole history once.
        loaded = [x.d for x in bq.query(
            f"select max(report_date) as d from `{table_id}` where account_id = @a and ad_id is not null",
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
        try:
            ads = ad_rows(meta, account, now)
        except RuntimeError as e:  # names and thumbnails are optional: keep the last good list
            log(f"meta {account}: ad list failed, keeping the last one: {e}")
            continue
        replace_rows(bq, ads_id, ADS_SCHEMA, "account_id = @a", [
            bigquery.ScalarQueryParameter("a", "STRING", account.removeprefix("act_"))], ads)
        log(f"meta {account}: {len(ads)} ads")


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
    add_missing_columns(bq, ensure_table(bq, dataset, META_TABLE, META_SCHEMA, "report_date"), META_SCHEMA)
    ensure_table(bq, dataset, ADS_TABLE, ADS_SCHEMA, None)

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
