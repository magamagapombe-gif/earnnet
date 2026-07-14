-- ============================================================
--  EarnNet – Rate bump, 3 new entry plans, tiered task payouts
--  Run AFTER schema_growth_plans.sql.
--
--  What this changes:
--   1. Bumps every plan's return rate up slightly (still capped
--      at 10%, per your rule).
--   2. Retires the old 1-month "Starter"/"Basic" pair and replaces
--      them with THREE 1-month plans at 50,000 / 100,000 / 200,000
--      — each its own level (different task_limit + multiplier).
--   3. Makes task rewards actually depend on the buyer's plan.
--      Previously `task_limit`/`multiplier` were only ever shown in
--      the UI — complete_task() paid every user the same flat
--      `tasks.reward` regardless of plan. Now: the SAME task pays
--      `tasks.reward × multiplier` of whichever active plan gives
--      the user their best multiplier, and a user is capped at
--      that plan's task_limit completions per day.
-- ============================================================

-- ── 1. Bump existing rates (still ≤ 10%) ───────────────────────
update investment_plans set rate_percent = 6  where name = 'Bronze';
update investment_plans set rate_percent = 7  where name = 'Silver Plan';
update investment_plans set rate_percent = 8  where name = 'Gold Plan';
update investment_plans set rate_percent = 9  where name = 'Platinum Plan';
update investment_plans set rate_percent = 10 where name = 'Elite';
update investment_plans set rate_percent = 10 where name = 'Legend';

-- ── 2. Retire old 1-month pair, add 3 new 1-month plans ─────────
update investment_plans set is_active = false where name in ('Starter', 'Basic');

insert into investment_plans (name, icon, duration_months, min_amount, rate_percent, vip_tier, task_limit, multiplier, sort_order, is_active)
values
  ('Bronze Start', '🌱', 1, 50000,  4, 'silver', 5,  1.05, 1, true),
  ('Silver Start', '🌿', 1, 100000, 5, 'silver', 8,  1.10, 2, true),
  ('Gold Start',   '🍀', 1, 200000, 6, 'gold',   12, 1.15, 3, true)
on conflict (name) do update set
  min_amount   = excluded.min_amount,
  rate_percent = excluded.rate_percent,
  task_limit   = excluded.task_limit,
  multiplier   = excluded.multiplier,
  is_active    = true;

-- ── 3. Tiered task payouts + daily task-limit enforcement ──────
-- Requires an active plan to complete tasks at all (this was
-- already true client-side; now enforced server-side too).
create or replace function complete_task(p_user_id uuid, p_task_id uuid)
returns void language plpgsql security definer as $$
declare
  v_reward_base integer;
  v_reward      integer;
  v_task_title  text;
  v_status      text;
  v_multiplier  numeric;
  v_task_limit  integer;
  v_today_count integer;
begin
  select reward, title, status into v_reward_base, v_task_title, v_status
    from tasks where id = p_task_id for update;

  if v_status <> 'active' then
    raise exception 'Task is not active';
  end if;

  -- Best active plan (highest multiplier) drives this user's payout level
  select multiplier, task_limit into v_multiplier, v_task_limit
    from user_investments
    where user_id = p_user_id and status = 'active'
    order by multiplier desc
    limit 1;

  if v_multiplier is null then
    raise exception 'An active growth plan is required to complete tasks';
  end if;

  if v_task_limit is not null then
    select count(*) into v_today_count
      from task_completions
      where user_id = p_user_id and completed_at >= date_trunc('day', now());
    if v_today_count >= v_task_limit then
      raise exception 'Daily task limit reached for your plan (% tasks/day)', v_task_limit;
    end if;
  end if;

  v_reward := floor(v_reward_base * v_multiplier);

  insert into task_completions (user_id, task_id) values (p_user_id, p_task_id);

  update profiles
    set balance = balance + v_reward,
        total_earned = total_earned + v_reward,
        tasks_done = tasks_done + 1
    where id = p_user_id;

  insert into transactions (user_id, amount, type, description)
    values (p_user_id, v_reward, 'task', v_task_title || ' (×' || v_multiplier || ')');

  update tasks
    set completions = completions + 1,
        used = used + v_reward,
        status = case when (completions + 1) >= limit_count then 'completed' else status end
    where id = p_task_id;
end;
$$;
