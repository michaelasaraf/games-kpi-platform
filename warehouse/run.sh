#!/usr/bin/env sh
# Entry point for the Railway cron service: builds all KPI models.
# Needs GCP_PROJECT and GCP_SA_KEY_JSON (the service account key: JSON text, or base64 of the key file).
set -eu
: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${GCP_SA_KEY_JSON:?set GCP_SA_KEY_JSON}"
export DBT_TARGET="${DBT_TARGET:-prod}"
export GCP_KEYFILE="${GCP_KEYFILE:-/tmp/gcp-sa.json}"
cd "$(dirname "$0")"
python scripts/write_keyfile.py "$GCP_KEYFILE"
exec dbt build --profiles-dir . "$@"
