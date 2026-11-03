#!/usr/bin/env sh
# Entry point for the Railway cron service: builds all KPI models.
# Needs GCP_PROJECT and GCP_SA_KEY_JSON (the service account key, as JSON text).
set -eu
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${GCP_SA_KEY_JSON:?set GCP_SA_KEY_JSON}"
export DBT_TARGET="${DBT_TARGET:-prod}"
export GCP_KEYFILE="${GCP_KEYFILE:-/tmp/gcp-sa.json}"
printf '%s' "$GCP_SA_KEY_JSON" > "$GCP_KEYFILE"
chmod 600 "$GCP_KEYFILE"
cd "$(dirname "$0")"
exec dbt build --profiles-dir . "$@"
