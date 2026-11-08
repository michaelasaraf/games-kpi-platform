"""Loads store revenue into BigQuery before the dbt build: Google Play sales and AdMob earnings.

These are the money totals the dashboard reports for games whose dbt_project.yml entry says
iap_source: play_reports or ad_revenue_source: admob_api. They cover every game in the developer
and AdMob accounts; dbt picks each game's rows by its package_name.

  Google Play  The estimated sales reports Play writes to the developer account's Cloud Storage
               bucket (sales/salesreport_YYYYMM.zip, updated daily). Needs PLAY_REPORTS_BUCKET
               (gs://pubsite_prod_...) and the service account invited in Play Console with
               "View app information and download bulk reports" and "View financial data".
               Amounts are in the buyer's currency; they are converted to USD with that day's rate.
  AdMob        The AdMob API mediation report (every ad source, earnings in USD). The API only
               accepts a user's OAuth sign-in: needs ADMOB_CLIENT_ID, ADMOB_CLIENT_SECRET and
               ADMOB_REFRESH_TOKEN (see docs/setup.md, "Revenue from Google Play and AdMob").

A source whose settings are missing is skipped. A failing source is reported and the build goes
on, so the rest of the dashboard still refreshes; the tables keep their last good load.

Usage: python scripts/load_revenue.py   (needs GCP_PROJECT and GCP_KEYFILE, like dbt)
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import os
import re
import sys
import traceback
import zipfile

import requests
from google.cloud import bigquery, storage
from google.oauth2 import service_account

PLAY_TABLE = "src_play_sales"
ADMOB_TABLE = "src_admob_daily"
ADMOB_BACKFILL_DAYS = 365
ADMOB_LOOKBACK_DAYS = 7  # AdMob finalises estimated earnings over a few days.

PLAY_SCHEMA = [
    bigquery.SchemaField("report_month", "STRING"),
    bigquery.SchemaField("order_number", "STRING"),
    bigquery.SchemaField("charged_ts", "TIMESTAMP"),
    bigquery.SchemaField("financial_status", "STRING"),
    bigquery.SchemaField("product_type", "STRING"),
    bigquery.SchemaField("package_name", "STRING"),
    bigquery.SchemaField("sku_id", "STRING"),
    bigquery.SchemaField("product_title", "STRING"),
    bigquery.SchemaField("currency", "STRING"),
    bigquery.SchemaField("item_price", "FLOAT"),
    bigquery.SchemaField("taxes", "FLOAT"),
    bigquery.SchemaField("charged_amount", "FLOAT"),
    bigquery.SchemaField("country_code", "STRING"),
    bigquery.SchemaField("usd_rate", "FLOAT", description="units of currency per USD on the charge day"),
    bigquery.SchemaField("item_price_usd", "FLOAT", description="item price (no tax) in USD; negative for refunds"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]

ADMOB_SCHEMA = [
    bigquery.SchemaField("report_date", "DATE", description="in the AdMob account's time zone"),
    bigquery.SchemaField("app_id", "STRING"),
    bigquery.SchemaField("app_name", "STRING"),
    bigquery.SchemaField("package_name", "STRING"),
    bigquery.SchemaField("platform", "STRING"),
    bigquery.SchemaField("country_code", "STRING"),
    bigquery.SchemaField("ad_format", "STRING"),
    bigquery.SchemaField("ad_source", "STRING"),
    bigquery.SchemaField("earnings_usd", "FLOAT"),
    bigquery.SchemaField("impressions", "INTEGER"),
    bigquery.SchemaField("clicks", "INTEGER"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP"),
]


def log(msg: str) -> None:
    print(f"[load_revenue] {msg}", flush=True)


# --- BigQuery -------------------------------------------------------------------------------


def ensure_table(bq: bigquery.Client, dataset: str, name: str, schema, partition_field: str | None) -> str:
    table_id = f"{bq.project}.{dataset}.{name}"
    table = bigquery.Table(table_id, schema=schema)
    if partition_field:
        table.time_partitioning = bigquery.TimePartitioning(field=partition_field)
    bq.create_table(table, exists_ok=True)
    return table_id


def replace_rows(bq: bigquery.Client, table_id: str, schema, where: str, params, rows: list[dict]) -> None:
    """Deletes the rows matching `where`, then loads `rows` (one load job, no streaming buffer)."""
    bq.query(f"delete from `{table_id}` where {where}", job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    if rows:
        cfg = bigquery.LoadJobConfig(schema=schema, write_disposition="WRITE_APPEND")
        bq.load_table_from_json(rows, table_id, job_config=cfg).result()


# --- Google Play ----------------------------------------------------------------------------


def number(text: str | None) -> float | None:
    if text is None:
        return None
    t = text.strip().replace(",", "")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


class Fx:
    """Daily USD rates for any currency, from the free currency-api dataset (no key)."""

    URLS = (
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{d}/v1/currencies/usd.min.json",
        "https://{d}.currency-api.pages.dev/v1/currencies/usd.min.json",
    )

    def __init__(self) -> None:
        self.cache: dict[str, dict[str, float]] = {}

    def _day(self, d: str) -> dict[str, float] | None:
        if d not in self.cache:
            rates = None
            for url in self.URLS:
                try:
                    r = requests.get(url.format(d=d), timeout=20)
                    if r.status_code == 200:
                        rates = {k.upper(): float(v) for k, v in r.json()["usd"].items() if v}
                        break
                except (requests.RequestException, ValueError, KeyError):
                    continue
            self.cache[d] = rates  # type: ignore[assignment]
        return self.cache[d]

    def per_usd(self, currency: str, day: dt.date) -> float | None:
        """Units of `currency` per USD on `day`, falling back to the latest published rates."""
        if currency.upper() == "USD":
            return 1.0
        for d in (day.isoformat(), (day - dt.timedelta(days=1)).isoformat(), "latest"):
            rates = self._day(d)
            if rates and rates.get(currency.upper()):
                return rates[currency.upper()]
        return None


REFUND_STATUSES = ("refund", "partial refund", "chargeback", "charged back", "reversed")


def parse_sales_report(month: str, blob_bytes: bytes, fx: Fx, now: str) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(blob_bytes)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        text = z.read(name).decode("utf-8-sig")
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        ts = r.get("Order Charged Timestamp")
        if ts and ts.strip().isdigit():
            charged = dt.datetime.fromtimestamp(int(ts), dt.timezone.utc)
        else:
            charged = dt.datetime.strptime(r["Order Charged Date"].strip(), "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
        status = (r.get("Financial Status") or "").strip()
        currency = (r.get("Currency of Sale") or "").strip()
        price = number(r.get("Item Price"))
        rate = fx.per_usd(currency, charged.date()) if currency else None
        price_usd = None
        if price is not None and rate:
            sign = -1 if status.lower() in REFUND_STATUSES else 1
            price_usd = sign * abs(price) / rate
        rows.append({
            "report_month": month,
            "order_number": (r.get("Order Number") or "").strip(),
            "charged_ts": charged.isoformat(),
            "financial_status": status,
            "product_type": (r.get("Product Type") or "").strip(),
            "package_name": (r.get("Product ID") or "").strip(),
            "sku_id": (r.get("SKU ID") or "").strip(),
            "product_title": (r.get("Product Title") or "").strip(),
            "currency": currency,
            "item_price": price,
            "taxes": number(r.get("Taxes Collected")),
            "charged_amount": number(r.get("Charged Amount")),
            "country_code": (r.get("Country of Buyer") or "").strip().upper() or None,
            "usd_rate": rate,
            "item_price_usd": price_usd,
            "loaded_at": now,
        })
    missing = sum(1 for x in rows if x["item_price_usd"] is None)
    if missing:
        log(f"play {month}: {missing} of {len(rows)} rows have no USD rate or price; they count as 0")
    return rows


def load_play(bq: bigquery.Client, creds, dataset: str, bucket_uri: str) -> None:
    table_id = ensure_table(bq, dataset, PLAY_TABLE, PLAY_SCHEMA, "charged_ts")
    bucket_name = re.sub(r"^gs://", "", bucket_uri).strip("/").split("/")[0]
    gcs = storage.Client(project=bq.project, credentials=creds)
    blobs = {}
    for b in gcs.list_blobs(bucket_name, prefix="sales/"):
        m = re.search(r"salesreport_(\d{6})\.zip$", b.name)
        if m:
            blobs[m.group(1)] = b
    if not blobs:
        log(f"play: no sales/salesreport_*.zip in gs://{bucket_name} yet")
        return
    loaded = [r.m for r in bq.query(f"select max(report_month) as m from `{table_id}`").result()][0]
    # Re-read the last loaded month (Play keeps updating it) and everything after it.
    months = sorted(m for m in blobs if loaded is None or m >= loaded)
    fx = Fx()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for month in months:
        rows = parse_sales_report(month, blobs[month].download_as_bytes(), fx, now)
        replace_rows(bq, table_id, PLAY_SCHEMA, "report_month = @m",
                     [bigquery.ScalarQueryParameter("m", "STRING", month)], rows)
        log(f"play {month}: {len(rows)} rows")


# --- AdMob ----------------------------------------------------------------------------------

ADMOB_API = "https://admob.googleapis.com/v1"


def admob_session() -> requests.Session:
    r = requests.post("https://oauth2.googleapis.com/token", timeout=30, data={
        "client_id": os.environ["ADMOB_CLIENT_ID"],
        "client_secret": os.environ["ADMOB_CLIENT_SECRET"],
        "refresh_token": os.environ["ADMOB_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    })
    if r.status_code != 200:
        raise RuntimeError(f"AdMob sign-in failed ({r.status_code}): {r.text[:300]}")
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return s


def ymd(d: dt.date) -> dict:
    return {"year": d.year, "month": d.month, "day": d.day}


def admob_apps(s: requests.Session, account: str) -> dict[str, dict]:
    apps, token = {}, None
    while True:
        r = s.get(f"{ADMOB_API}/{account}/apps", params={"pageSize": 1000, **({"pageToken": token} if token else {})}, timeout=60)
        r.raise_for_status()
        body = r.json()
        for a in body.get("apps", []):
            apps[a["appId"]] = a
        token = body.get("nextPageToken")
        if not token:
            return apps


def load_admob(bq: bigquery.Client, dataset: str) -> None:
    table_id = ensure_table(bq, dataset, ADMOB_TABLE, ADMOB_SCHEMA, "report_date")
    s = admob_session()
    r = s.get(f"{ADMOB_API}/accounts", timeout=60)
    r.raise_for_status()
    accounts = [a["name"] for a in r.json().get("account", [])]
    if not accounts:
        log("admob: the signed-in user has no AdMob account")
        return
    loaded = [x.d for x in bq.query(f"select max(report_date) as d from `{table_id}`").result()][0]
    end = dt.date.today()
    start = end - dt.timedelta(days=ADMOB_LOOKBACK_DAYS if loaded else ADMOB_BACKFILL_DAYS)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = []
    for account in accounts:
        apps = admob_apps(s, account)
        spec = {"reportSpec": {
            "dateRange": {"startDate": ymd(start), "endDate": ymd(end)},
            "dimensions": ["DATE", "APP", "COUNTRY", "FORMAT", "PLATFORM", "AD_SOURCE"],
            "metrics": ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS"],
            "localizationSettings": {"currencyCode": "USD"},
        }}
        r = s.post(f"{ADMOB_API}/{account}/mediationReport:generate", json=spec, timeout=300)
        r.raise_for_status()
        for item in r.json():
            row = item.get("row")
            if not row:
                continue
            dims, mets = row["dimensionValues"], row["metricValues"]
            app_id = dims.get("APP", {}).get("value")
            app = apps.get(app_id, {})
            d = dims["DATE"]["value"]
            rows.append({
                "report_date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                "app_id": app_id,
                "app_name": dims.get("APP", {}).get("displayLabel"),
                "package_name": app.get("linkedAppInfo", {}).get("appStoreId"),
                "platform": (dims.get("PLATFORM", {}).get("value") or app.get("platform") or "").lower() or None,
                "country_code": dims.get("COUNTRY", {}).get("value"),
                "ad_format": (dims.get("FORMAT", {}).get("value") or "").lower() or None,
                "ad_source": dims.get("AD_SOURCE", {}).get("displayLabel") or dims.get("AD_SOURCE", {}).get("value"),
                "earnings_usd": int(mets.get("ESTIMATED_EARNINGS", {}).get("microsValue", 0)) / 1e6,
                "impressions": int(mets.get("IMPRESSIONS", {}).get("integerValue", 0)),
                "clicks": int(mets.get("CLICKS", {}).get("integerValue", 0)),
                "loaded_at": now,
            })
    replace_rows(bq, table_id, ADMOB_SCHEMA, "report_date between @s and @e",
                 [bigquery.ScalarQueryParameter("s", "DATE", start), bigquery.ScalarQueryParameter("e", "DATE", end)], rows)
    log(f"admob {start}..{end}: {len(rows)} rows from {len(accounts)} account(s)")


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
    ensure_table(bq, dataset, PLAY_TABLE, PLAY_SCHEMA, "charged_ts")
    ensure_table(bq, dataset, ADMOB_TABLE, ADMOB_SCHEMA, "report_date")

    failed = False
    if os.environ.get("PLAY_REPORTS_BUCKET"):
        try:
            load_play(bq, creds, dataset, os.environ["PLAY_REPORTS_BUCKET"])
        except Exception:  # noqa: BLE001 - keep the build going, report loudly
            failed = True
            log("play: FAILED\n" + traceback.format_exc())
    else:
        log("play: skipped, PLAY_REPORTS_BUCKET is not set")
    if all(os.environ.get(k) for k in ("ADMOB_CLIENT_ID", "ADMOB_CLIENT_SECRET", "ADMOB_REFRESH_TOKEN")):
        try:
            load_admob(bq, dataset)
        except Exception:  # noqa: BLE001
            failed = True
            log("admob: FAILED\n" + traceback.format_exc())
    else:
        log("admob: skipped, ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET / ADMOB_REFRESH_TOKEN are not set")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
