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
  select pd.game_id, pd.player_id, any_value(coalesce(pd.platform, 'unknown')) as platform,
    any_value(coalesce(ua.ua_source, 'unknown')) as ua_source
  from {{ ref('player_day') }} as pd
  left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
  where pd.days_since_install = 0
  group by 1, 2
)
select
  s.game_id,
  s.install_date,
  c.platform,
  c.ua_source,
  s.step,
  any_value(s.step_name) as step_name,
  count(distinct s.player_id) as players
from steps as s
join cohort_platform as c using (game_id, player_id)
where s.step is not null
group by 1, 2, 3, 4, 5
