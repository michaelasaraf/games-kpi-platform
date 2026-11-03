-- Tutorial funnel by install cohort: how many players of each install day reached each step.
-- Step 0 = tutorial_begin, 9999 = tutorial_complete.
with steps as (
  select
    game_id,
    install_date,
    player_id,
    case
      when event_name = 'tutorial_begin' then 0
      when event_name = 'tutorial_complete' then 9999
      else tutorial_step
    end as step,
    tutorial_step_name as step_name
  from {{ ref('clean_events') }}
  where event_name in ('tutorial_begin', 'tutorial_step', 'tutorial_complete')
),
cohort_platform as (
  select game_id, player_id, any_value(coalesce(platform, 'unknown')) as platform
  from {{ ref('player_day') }}
  where days_since_install = 0
  group by 1, 2
)
select
  s.game_id,
  s.install_date,
  c.platform,
  s.step,
  any_value(s.step_name) as step_name,
  count(distinct s.player_id) as players
from steps as s
join cohort_platform as c using (game_id, player_id)
where s.step is not null
group by 1, 2, 3, 4
