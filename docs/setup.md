# Running the platform

This is for whoever owns the platform: one-time Google Cloud and Railway setup, then what to do for each new game.

What runs where:

| Piece | Where | Cost at 5 to 10k DAU in total |
|---|---|---|
| Firebase Analytics + BigQuery export | Each game's Firebase project | Free collection; streaming export about $0.05 per GB |
| KPI tables (`games_kpi` dataset) | One Google Cloud project for the platform | Storage and queries mostly inside the BigQuery free tier |
| `kpi-models` (dbt, hourly) | Railway cron service | A few cents a run |
| `dashboard` (API + web) | Railway web service | One small service |

## 1. Turn on BigQuery export (per game)

In the game's Firebase console: **Project settings > Integrations > BigQuery > Link**.

- Include **Google Analytics**, and pick both **Daily** and **Streaming**. Streaming fills
  `events_intraday_*` so the dashboard shows today's data within the hour.
- Choose the data location once and use the same one for every game and for the `games_kpi` dataset
  (for example `US`). BigQuery cannot join datasets in different locations, and the location cannot be changed later.
- The project needs billing on (Blaze plan). Without it, BigQuery runs in sandbox mode and deletes tables after 60 days.
- Export starts on the day you link it. Firebase does not backfill earlier days, so link every game as early as possible.

After a day, the game's project has a dataset named `analytics_<number>`. Note the number.

## 2. Create the platform project and dataset

Pick or create one Google Cloud project for the platform, here called `games-kpi`.

```sh
gcloud config set project games-kpi
bq --location=US mk --dataset games-kpi:games_kpi
```

## 3. Service accounts

Use two: one that builds the KPI tables, and one with read-only access for the dashboard.

```sh
gcloud iam service-accounts create kpi-models --display-name "KPI models (dbt)"
gcloud iam service-accounts create kpi-dashboard --display-name "KPI dashboard (read only)"

# Both run queries in the platform project
for sa in kpi-models kpi-dashboard; do
  gcloud projects add-iam-policy-binding games-kpi \
    --member "serviceAccount:$sa@games-kpi.iam.gserviceaccount.com" --role roles/bigquery.jobUser
done
```

Then, in the BigQuery console (**dataset > Sharing > Permissions**):

| Dataset | Service account | Role |
|---|---|---|
| `games-kpi:games_kpi` | `kpi-models` | BigQuery Data Editor |
| `games-kpi:games_kpi` | `kpi-dashboard` | BigQuery Data Viewer |
| Each game's `analytics_<number>` | `kpi-models` | BigQuery Data Viewer |

Create a JSON key for each service account (**IAM > Service accounts > Keys > Add key**). The keys go into
Railway variables below; do not commit them.

## 4. Google sign-in for the dashboard

**APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Web application**.
Add the dashboard URL (for example `https://kpi.up.railway.app`) and `http://localhost:5173` under
**Authorized JavaScript origins**. The client id is `GOOGLE_CLIENT_ID`. If the studio uses Google Workspace,
set the consent screen to **Internal**.

## 5. Railway

Create one Railway project with two services from this repo.

**`dashboard`** (root directory: repo root; uses `railway.json` and `Dockerfile`):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `GCP_PROJECT` | `games-kpi` |
| `BQ_DATASET` | `games_kpi` |
| `BQ_LOCATION` | `US` |
| `GCP_SA_KEY_JSON` | the `kpi-dashboard` key, pasted as JSON text |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `ACCESS_JSON` | who sees what, see below |
| `CACHE_TTL_SECONDS` | optional, default `300` |
| `MAX_BYTES_BILLED` | optional, default 5 GB per query |

`ACCESS_JSON` example:

```json
{
  "admins": ["michael@studio.com"],
  "users": { "pm.one@studio.com": ["game_a", "game_b"] },
  "domains": { "studio.com": "*" }
}
```

Admins see every game; `users` and `domains` map to `"*"` or a list of `game_id`s. Anyone else who signs in
sees no games.

**`kpi-models`** (root directory: `warehouse`; uses `warehouse/railway.json`, a cron at minute 15 of every hour):

| Variable | Value |
|---|---|
| `GCP_PROJECT` | `games-kpi` |
| `BQ_DATASET` | `games_kpi` |
| `BQ_LOCATION` | `US` |
| `GCP_SA_KEY_JSON` | the `kpi-models` key |

Each run rebuilds the last 3 days (`lookback_days`), because Firebase keeps updating a day's export for up
to 72 hours.

### First run and backfills

The first run builds everything from `start_date` in `dbt_project.yml`. To rebuild all history later (for
example after changing a model's logic), run once from a laptop:

```sh
cd warehouse
pip install -r requirements.txt
gcloud auth application-default login
GCP_PROJECT=games-kpi BQ_DATASET=games_kpi dbt build --profiles-dir . --full-refresh
```

Leave out `BQ_DATASET` to build into `games_kpi_dev` instead, which is the safe way to try a model change.

## 6. Add a game

1. Do step 1 for the game's Firebase project, and give `kpi-models` Data Viewer on its `analytics_<number>` dataset.
2. Add the game under `vars.games` in `warehouse/dbt_project.yml`:

   ```yaml
   - game_id: gems_crafter          # letters, digits, _; never change it later
     name: Gems Crafter
     engine: unity                  # unity | flutter
     firebase_project: gems-crafter-prod
     analytics_dataset: analytics_123456789
     timezone: Europe/Berlin        # defines the game's "day" on the dashboard
     iap_source: wrapper            # see the integration guide, "Revenue sources"
     ad_revenue_source: wrapper
     store_fee: 0.15                # 0.15 for small-business rates, else 0.30
     d1_target: 0.40
     d7_target: 0.15
   ```

3. Merge. The next hourly run includes the game, and it appears on the dashboard for admins and for
   anyone `ACCESS_JSON` allows.
4. Send the game team the [integration guide](integration-guide.md) and check their Integration tab.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `kpi-models` fails with "Not found: Dataset" | Wrong `firebase_project` or `analytics_dataset`, or `kpi-models` has no access to it. |
| "Cannot query over table ... in different location" | The game's export and `games_kpi` are in different locations. Re-link the export in the right one. |
| Dashboard shows no games after sign-in | The email is not in `ACCESS_JSON`, or the game has no rows yet. |
| Today's numbers are empty | Streaming export is off; daily tables arrive about a day later. |
| Revenue looks doubled | `ad_revenue_source` or `iap_source` does not match what the game sends. |
