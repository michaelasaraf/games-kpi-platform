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

If the game buys installs on Google Ads, also link the Ads account (**Project settings > Integrations > Google Ads**).
Firebase then attributes Google Ads installs itself, which fills the UA source for games without Tenjin.

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

`GCP_SA_KEY_JSON` takes the key file's JSON as pasted, or the file base64-encoded on one line, for editors
that only accept one `KEY=value` line. On Windows, this copies the base64 form to the clipboard:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\<key-file>.json")) | Set-Clipboard
```

On macOS or Linux: `base64 -w0 key.json` (macOS: `base64 -i key.json`).

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

## 7. Revenue from Google Play and AdMob

Games with `iap_source: play_reports` or `ad_revenue_source: admob_api` take their revenue from the
stores, not from events. Before each build, `scripts/load_revenue.py` loads Google Play's sales
reports and AdMob's mediation report into `src_play_sales` and `src_admob_daily`, and dbt matches the rows
to games by `package_name`. Set each source up once; that covers every game in the account.

These are account totals with no player id. On the dashboard they show under the UA source
`unattributed`, so a UA source filter leaves them out. They are also missing from cohort LTV and payer counts.
Linking AdMob and Google Play to each game's Firebase project adds per-player revenue for those views.

**Google Play**

1. In Play Console → Users and permissions, invite `kpi-models@games-kpi.iam.gserviceaccount.com`
   with **View app information and download bulk reports** and **View financial data**. Google can take up to a day to apply it.
2. Play Console → Download reports → Financial → **Copy Cloud Storage URI** (`gs://pubsite_prod_...`).
3. Set `PLAY_REPORTS_BUCKET` to it on the `kpi-models` service.

The job reads `sales/salesreport_YYYYMM.zip` (estimated sales, updated daily): real orders only,
since license testers are never charged. It converts each order's buyer currency to USD at that day's rate
(from the free currency-api dataset), books refunds as negative, and counts the item price without tax
as gross. Net applies `store_fee`.

**AdMob**

The AdMob API only accepts a user's sign-in, so this runs as you, read-only.

1. In the `games-kpi` Google Cloud project, enable the **AdMob API**.
2. APIs & Services → OAuth consent screen: set it up as External, add yourself as a test user,
   and publish it (in Testing mode, refresh tokens expire after 7 days).
3. Credentials → Create credentials → OAuth client ID → **Desktop app**. Note the client id and secret.
4. `python warehouse/scripts/admob_auth.py url CLIENT_ID`, open the link, allow access, then
   `python warehouse/scripts/admob_auth.py token CLIENT_ID CLIENT_SECRET '<the localhost address>'`.
5. Set `ADMOB_CLIENT_ID`, `ADMOB_CLIENT_SECRET` and `ADMOB_REFRESH_TOKEN` on the `kpi-models` service.

The first run loads the last 365 days, and later runs reload the last 7. Earnings are in USD, from
every mediated ad source. AdMob days follow the AdMob account's time zone.

If a source fails, the job logs `load_revenue` with the error, and the build keeps the last good load.

## 8. UA spend from Meta Ads

Before each build, `scripts/load_ua_costs.py` loads daily Meta (Facebook) Ads spend per ad account,
ad set and country into `src_meta_ads_daily`, and dbt builds `kpi_ua_spend` (spend, impressions, clicks
and Meta-reported installs per game, day, platform, country and campaign). It is the base for CPI and ROAS.

1. In Meta Business Settings (business.facebook.com/settings) → Users → **System users**, add a system user
   (for example `kpi-models`, role Employee).
2. Click it → **Assign assets** → Ad accounts → pick every ad account that runs game campaigns, with
   **View performance**.
3. If the business has no app of its own yet: developers.facebook.com/apps → Create app → type **Business**,
   connected to the same business portfolio. In Business Settings → Apps, assign it to the system user.
4. Back on the system user → **Generate new token** → choose the app, expiration **Never**, permission
   **ads_read**. Copy the token.
5. Set `META_ACCESS_TOKEN` to the token and `META_AD_ACCOUNT_IDS` to the ad account ids (the `act=` number
   in the Ads Manager address, comma separated) on the `kpi-models` service.

Spend is matched to a game by the app the ad set promotes (the store link of an app install campaign),
against the game's `package_name` and `extra_package_names`; that link also gives the platform. For ad sets
with no store link, add the game's `meta_app_ids` or a `meta_campaign_regex` in `dbt_project.yml`.
Spend in another currency is converted to USD at that day's rate. Days follow the ad account's time zone.

The first run loads the last 365 days, and later runs reload the last 7, because Meta keeps adding
installs to a day. If the load fails, the job logs `load_ua_costs` with the error and the build keeps
the last good load.

## 9. History from before the BigQuery export

The export only holds events from the day it was linked. `warehouse/scripts/load_history.py`
(run by `run.sh` before dbt) fills the earlier days with daily totals, which `history_daily`
shows in `kpi_daily` and `kpi_active_users` with UA source "unknown":

- **GA4 (Firebase Analytics):** DAU, 7/28-day active users, new players, sessions and playtime per
  day, platform and country, from the game's GA4 property (the number in `analytics_dataset`, or
  set `ga4_property_id`). Setup, once: enable the
  [Google Analytics Data API](https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com)
  in the platform project, then in each game's Firebase console open Analytics > Admin >
  Property access management and add the `kpi-models` service account as a **Viewer**. GA4 also
  replaces the export's first day, which only holds part of that day.
- **Google Play install statistics:** daily user installs per country (Android) from the reports
  bucket (`PLAY_REPORTS_BUCKET`), used as new players on pre-export days GA4 has no data for.

Retention, levels, tutorial, economy and UA source need each player's events, so they still start
on the export's first day.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `kpi-models` fails with "Not found: Dataset" | Wrong `firebase_project` or `analytics_dataset`, or `kpi-models` has no access to it. |
| "Cannot query over table ... in different location" | The game's export and `games_kpi` are in different locations. Re-link the export in the right one. |
| Dashboard shows no games after sign-in | The email is not in `ACCESS_JSON`, or the game has no rows yet. |
| Today's numbers are empty | Streaming export is off; daily tables arrive about a day later. |
| Revenue looks doubled | `ad_revenue_source` or `iap_source` does not match what the game sends. |
| Store revenue is $0 | Check the `load_revenue` lines in the `kpi-models` log: a source not set up, Play access not applied yet, or a `package_name` that does not match the store. |
