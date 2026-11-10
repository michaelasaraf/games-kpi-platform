"""Loads daily player totals from before each game's BigQuery export started.

Firebase's BigQuery export only holds events from the day it was linked, so DAU, installs and
playtime would start on that day. These two sources keep earlier daily totals; dbt
(clean/history_daily) uses them for the days before a game's export, and kpi_daily and
kpi_active_users show them there. They have no players, so retention, levels, tutorial, economy
and UA source stay export-only.

  GA4 Data API  The game's Firebase Analytics property: active users (1, 7 and 28 days), new
                users, sessions and engagement time per day, platform and country. The property
                id is the number in analytics_dataset (or ga4_property_id). Needs the Google
                Analytics Data API enabled in the GCP project and the service account added as a
                Viewer under the property's Admin > Property access management.
  Google Play   Play Console's install statistics in the reports bucket
                (stats/installs/installs_<package>_<YYYYMM>_country.csv): daily user installs per
                country, used for Android installs on days GA4 has no data for. Needs
                PLAY_REPORTS_BUCKET, like load_revenue.py.

A source that is not set up is skipped and a failing one is reported, like load_revenue.py.

Usage: python scripts/load_history.py   (needs GCP_PROJECT and GCP_KEYFILE, like dbt)
"""
from __future__ import annotations

import csv
import datetime as dt
import gzip
import io
import os
import pathlib
import re
import sys
import traceback

import yaml
from google.auth.transport.requests import AuthorizedSession
from google.cloud import bigquery, storage
from google.oauth2 import service_account

from load_revenue import ensure_table, replace_rows

ROOT = pathlib.Path(__file__).resolve().parent.parent
GA4_TABLE = "src_ga4_daily"
PLAY_INSTALLS_TABLE = "src_play_installs"
GA4_LOOKBACK_DAYS = 7  # GA4 keeps processing a few days back.

GA4_SCHEMA = [
    bigquery.SchemaField("property_id", "STRING"),
    bigquery.SchemaField("report_date", "DATE", description="in the GA4 property's time zone"),
    bigquery.SchemaField("platform", "STRING"),
    bigquery.SchemaField("country", "STRING", description="English country name, as in the export's geo.country"),
    bigquery.SchemaField("active_users", "INTEGER"),
    bigquery.SchemaField("active_7d_users", "INTEGER"),
    bigquery.SchemaField("active_28d_users", "INTEGER"),
    bigquery.SchemaField("new_users", "INTEGER"),
    bigquery.SchemaField("sessions", "INTEGER"),
    bigquery.SchemaField("engagement_sec", "FLOAT"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]

PLAY_INSTALLS_SCHEMA = [
    bigquery.SchemaField("report_month", "STRING"),
    bigquery.SchemaField("install_date", "DATE"),
    bigquery.SchemaField("package_name", "STRING"),
    bigquery.SchemaField("country_code", "STRING"),
    bigquery.SchemaField("daily_user_installs", "INTEGER"),
    bigquery.SchemaField("daily_user_uninstalls", "INTEGER"),
    bigquery.SchemaField("daily_device_installs", "INTEGER"),
    bigquery.SchemaField("active_device_installs", "INTEGER"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]


def log(msg: str) -> None:
    print(f"[load_history] {msg}", flush=True)


def configured_games() -> list[dict]:
    return yaml.safe_load((ROOT / "dbt_project.yml").read_text())["vars"]["games"]


def ga4_property(g: dict) -> str | None:
    if g.get("ga4_property_id"):
        return str(g["ga4_property_id"])
    m = re.fullmatch(r"analytics_(\d+)", str(g.get("analytics_dataset") or ""))
    return m.group(1) if m else None


def start_date() -> dt.date:
    s = str(yaml.safe_load((ROOT / "dbt_project.yml").read_text())["vars"]["start_date"])
    return dt.datetime.strptime(s, "%Y%m%d").date()


# --- GA4 ------------------------------------------------------------------------------------

GA4_METRICS = ["activeUsers", "active7DayUsers", "active28DayUsers", "newUsers", "sessions", "userEngagementDuration"]


def ga4_rows(session: AuthorizedSession, prop: str, start: dt.date, end: dt.date, now: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        r = session.post(f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", timeout=120, json={
            "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
            "dimensions": [{"name": "date"}, {"name": "platform"}, {"name": "country"}],
            "metrics": [{"name": m} for m in GA4_METRICS],
            "limit": 100000,
            "offset": offset,
            "keepEmptyRows": False,
        })
        if r.status_code >= 400:
            try:
                detail = r.json()["error"]["message"]
            except (ValueError, KeyError, TypeError):
                detail = r.text
            raise RuntimeError(f"GA4 property {prop}: HTTP {r.status_code} {detail[:300]}")
        data = r.json()
        for row in data.get("rows", []):
            d, platform, country = (v["value"] for v in row["dimensionValues"])
            m = [v["value"] for v in row["metricValues"]]
            rows.append({
                "property_id": prop,
                "report_date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                "platform": platform.lower(),
                "country": None if country in ("", "(not set)") else country,
                "active_users": int(m[0]),
                "active_7d_users": int(m[1]),
                "active_28d_users": int(m[2]),
                "new_users": int(m[3]),
                "sessions": int(m[4]),
                "engagement_sec": float(m[5]),
                "loaded_at": now,
            })
        offset += len(data.get("rows", []))
        if not data.get("rows") or offset >= int(data.get("rowCount", 0)):
            return rows


def load_ga4(bq: bigquery.Client, creds, dataset: str) -> None:
    table_id = ensure_table(bq, dataset, GA4_TABLE, GA4_SCHEMA, "report_date")
    session = AuthorizedSession(creds.with_scopes(["https://www.googleapis.com/auth/analytics.readonly"]))
    loaded = {r.p: r.d for r in bq.query(
        f"select property_id as p, max(report_date) as d from `{table_id}` group by 1").result()}
    end = dt.date.today() - dt.timedelta(days=1)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    failed = []
    for g in configured_games():
        prop = ga4_property(g)
        if not prop:
            continue
        # First load: everything since start_date. Then only the last few days, which GA4 still updates.
        start = start_date() if prop not in loaded else min(loaded[prop], end) - dt.timedelta(days=GA4_LOOKBACK_DAYS)
        try:
            rows = ga4_rows(session, prop, start, end, now)
        except Exception as e:  # noqa: BLE001 - one game without access must not stop the others
            failed.append(g["game_id"])
            log(f"ga4 {g['game_id']}: FAILED {e}")
            continue
        replace_rows(bq, table_id, GA4_SCHEMA, "property_id = @p and report_date between @s and @e",
                     [bigquery.ScalarQueryParameter("p", "STRING", prop),
                      bigquery.ScalarQueryParameter("s", "DATE", start),
                      bigquery.ScalarQueryParameter("e", "DATE", end)], rows)
        log(f"ga4 {g['game_id']} (property {prop}) {start}..{end}: {len(rows)} rows")
    if failed:
        raise RuntimeError(f"ga4 failed for {', '.join(failed)}")


# --- Google Play install statistics ---------------------------------------------------------


def parse_installs_csv(month: str, data: bytes, now: str) -> list[dict]:
    text = data.decode("utf-16") if data[:2] in (b"\xff\xfe", b"\xfe\xff") else data.decode("utf-8-sig")
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        def n(key: str) -> int:
            v = (r.get(key) or "").strip()
            return int(float(v)) if v else 0
        rows.append({
            "report_month": month,
            "install_date": r["Date"],
            "package_name": r["Package name"],
            "country_code": (r.get("Country") or "").strip() or None,
            "daily_user_installs": n("Daily User Installs"),
            "daily_user_uninstalls": n("Daily User Uninstalls"),
            "daily_device_installs": n("Daily Device Installs"),
            "active_device_installs": n("Active Device Installs"),
            "loaded_at": now,
        })
    return rows


def load_play_installs(bq: bigquery.Client, creds, dataset: str, bucket_uri: str) -> None:
    table_id = ensure_table(bq, dataset, PLAY_INSTALLS_TABLE, PLAY_INSTALLS_SCHEMA, "install_date")
    bucket_name = re.sub(r"^gs://", "", bucket_uri).strip("/").split("/")[0]
    packages = {g["package_name"] for g in configured_games() if g.get("package_name")}
    gcs = storage.Client(project=bq.project, credentials=creds)
    loaded = {(r.p, r.m) for r in bq.query(
        f"select distinct package_name as p, report_month as m from `{table_id}`").result()}
    last = {}
    for p, m in loaded:
        last[p] = max(last.get(p, ""), m)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for b in gcs.list_blobs(bucket_name, prefix="stats/installs/"):
        m = re.fullmatch(r"stats/installs/installs_(.+)_(\d{6})_country\.csv", b.name)
        if not m or m.group(1) not in packages:
            continue
        package, month = m.groups()
        # Months already loaded are final, except the newest one (Play keeps adding days to it).
        if (package, month) in loaded and month < last.get(package, ""):
            continue
        # Play stores these gzip-encoded; read the stored bytes and unzip here (letting the
        # client decode them trips over some urllib3 versions).
        data = b.download_as_bytes(raw_download=True)
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        rows = parse_installs_csv(month, data, now)
        replace_rows(bq, table_id, PLAY_INSTALLS_SCHEMA, "package_name = @p and report_month = @m",
                     [bigquery.ScalarQueryParameter("p", "STRING", package),
                      bigquery.ScalarQueryParameter("m", "STRING", month)], rows)
        log(f"play installs {package} {month}: {len(rows)} rows")


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
    # The tables always exist, so the dbt models compile before either source is set up.
    ensure_table(bq, dataset, GA4_TABLE, GA4_SCHEMA, "report_date")
    ensure_table(bq, dataset, PLAY_INSTALLS_TABLE, PLAY_INSTALLS_SCHEMA, "install_date")

    failed = False
    try:
        load_ga4(bq, creds, dataset)
    except Exception:  # noqa: BLE001 - keep the build going, report loudly
        failed = True
        log("ga4: FAILED\n" + traceback.format_exc())
    if os.environ.get("PLAY_REPORTS_BUCKET"):
        try:
            load_play_installs(bq, creds, dataset, os.environ["PLAY_REPORTS_BUCKET"])
        except Exception:  # noqa: BLE001
            failed = True
            log("play installs: FAILED\n" + traceback.format_exc())
    else:
        log("play installs: skipped, PLAY_REPORTS_BUCKET is not set")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
