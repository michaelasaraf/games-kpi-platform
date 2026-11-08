#!/usr/bin/env sh
# Entry point for the Railway cron service: builds all KPI models.
# Needs GCP_PROJECT and GCP_SA_KEY_JSON (the service account key: JSON text, or base64 of the key file).
# Optional: PLAY_REPORTS_BUCKET and ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET / ADMOB_REFRESH_TOKEN (store revenue).
set -eu
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${GCP_SA_KEY_JSON:?set GCP_SA_KEY_JSON}"
export DBT_TARGET="${DBT_TARGET:-prod}"
export GCP_KEYFILE="${GCP_KEYFILE:-/tmp/gcp-sa.json}"
cd "$(dirname "$0")"
python scripts/write_keyfile.py "$GCP_KEYFILE"
# Store revenue (Google Play, AdMob). A failure is logged and the build still runs on the last good load.
python scripts/load_revenue.py || echo "load_revenue failed: building with the last good revenue load"
exec dbt build --profiles-dir . "$@"
