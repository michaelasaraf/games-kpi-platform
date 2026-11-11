#!/usr/bin/env sh
# Entry point for the Railway cron service: builds all KPI models.
# Needs GCP_PROJECT and GCP_SA_KEY_JSON (the service account key: JSON text, or base64 of the key file).
# Optional: PLAY_REPORTS_BUCKET and ADMOB_CLIENT_ID / ADMOB_CLIENT_SECRET / ADMOB_REFRESH_TOKEN (store revenue),
# META_ACCESS_TOKEN and META_AD_ACCOUNT_IDS (UA spend from Meta Ads).
set -eu
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${GCP_SA_KEY_JSON:?set GCP_SA_KEY_JSON}"
export DBT_TARGET="${DBT_TARGET:-prod}"
export GCP_KEYFILE="${GCP_KEYFILE:-/tmp/gcp-sa.json}"
# dbt's anonymous usage stats are sent at exit and can keep the process alive after "Done",
# which Railway counts as a still-running cron job (and then skips the next runs).
export DBT_SEND_ANONYMOUS_USAGE_STATS=false
cd "$(dirname "$0")"
python scripts/write_keyfile.py "$GCP_KEYFILE"
# Store revenue (Google Play, AdMob). A failure is logged and the build still runs on the last good load.
timeout 20m python scripts/load_revenue.py || echo "load_revenue failed: building with the last good revenue load"
# UA spend (Meta Ads). Same rule.
timeout 10m python scripts/load_ua_costs.py || echo "load_ua_costs failed: building with the last good spend load"
# Daily totals from before each game's BigQuery export (GA4 Data API, Play install stats). Same rule.
timeout 10m python scripts/load_history.py || echo "load_history failed: building with the last good history load"
# Hard stop well before the next hourly run, so one stuck run can never block the schedule.
exec timeout --kill-after=1m 40m dbt build --profiles-dir . "$@"
