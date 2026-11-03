# Games KPI platform

One KPI dashboard for all our games. Games keep using Firebase Analytics; this repo adds a shared
event catalog, thin Unity and Flutter wrappers, KPI models in BigQuery, and one dashboard on Railway.

```
Game (Unity / Flutter)
  └─ Kpi wrapper  ──>  Firebase Analytics  ──>  BigQuery export (one dataset per game)
                                                   │
                         warehouse/ (dbt, hourly)  ▼
                                         games_kpi dataset (clean + KPI tables)
                                                   │
                        api/ + web/ (Railway)      ▼
                                         Dashboard: portfolio + per-game KPIs, platform filter
```

## Repo layout

| Folder | What it is |
|---|---|
| `catalog/events.yaml` | The event catalog. The single source of truth for event names and params. |
| `tools/codegen` | Turns the catalog into the Unity and Flutter event methods and `docs/event-catalog.md`. |
| `sdk/unity` | Unity package (`com.gameskpi.analytics`): `Kpi.Init`, consent, typed events. |
| `sdk/flutter` | Dart package (`games_kpi`): `Kpi.init`, consent, typed events in `KpiEvents`. |
| `warehouse` | dbt project: cleans every game's Firebase export and builds the KPI tables. Runs as a Railway cron. |
| `api` | Fastify API: Google sign-in, per-game access, cached BigQuery queries. Also serves the web build. |
| `web` | React dashboard (ECharts). |
| `docs` | [Integration guide](docs/integration-guide.md) for game devs, [setup](docs/setup.md) for whoever runs the platform, [event catalog](docs/event-catalog.md). |

## Try it without Google Cloud

The demo runs the real API and dashboard on synthetic data for three games, using DuckDB in place of BigQuery.

```sh
cd web && npm ci && npm run build && cd ..
cd api && npm ci && npm run demo     # http://localhost:8080
```

## Add a game

1. The game team follows [the integration guide](docs/integration-guide.md) (about 3 to 5 dev days).
2. Turn on BigQuery export in that game's Firebase project, with streaming (see [setup](docs/setup.md#1-turn-on-bigquery-export-per-game)).
3. Give the platform service account read access to the export dataset.
4. Add one entry under `vars.games` in `warehouse/dbt_project.yml` and merge. The next hourly run picks it up.
5. Open the game's Integration tab on the dashboard and check every line says "Receiving".

## Change the event catalog

Edit `catalog/events.yaml`, then:

```sh
cd tools/codegen && npm ci && npm run codegen
```

Commit the regenerated files with the catalog change. CI fails if they are out of date.
Only add events or optional params; renaming or removing one breaks games already in the stores.

## Checks

| Part | Command |
|---|---|
| Catalog and codegen | `cd tools/codegen && npm test && npm run check` |
| API | `cd api && npm test && npm run typecheck` |
| Web | `cd web && npm run build && npm run lint` |
| Warehouse | `cd warehouse && dbt parse --profiles-dir . && python scripts/check_sql.py` |
| Unity wrapper | `sdk/unity/Tests~/run.sh` (needs mono) |
| Flutter wrapper | `cd sdk/flutter && flutter test && flutter analyze` |

CI runs all of them on every pull request (`.github/workflows/ci.yml`).
