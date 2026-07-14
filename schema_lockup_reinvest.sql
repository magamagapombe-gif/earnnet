-- ============================================================
--  EarnNet – Unit-trust-backed lockup model
--  Run AFTER schema_plan_rates_and_task_tiers.sql.
--
--  Model:
--   • investment_plans becomes a RATE LADDER by amount — the more
--     a user puts in, the higher their MONTHLY rate (capped 7%).
--   • Duration is picked freely at purchase time (1/3/6/12 months),
--     independent of which amount-tier the user is in — "plans
--     open for all months."
--   • Profit = amount × monthly_rate × months (simple, not
--     compounded), paid out once at maturity.
--   • Task earnings LOCK while a plan is active: they accrue
--     against the user's best active investment and are released
--     together with principal + profit at maturity.
--   • Reinvest: roll a matured payout into a new plan using
--     balance — no new mobile-money payment, no referral payout
--     (it's not fresh external money).
--   • Extend: push out an active plan's maturity date and
--     recompute profit for the new total duration.
--   • Multiple concurrent plans remain allowed.
-- ============================================================

-- ── 1. investment_plans → rate ladder (duration no longer fixed per plan) ──
alter table investment_plans alter column duration_months drop not null;
comment on column investment_plans.rate_percent is 'MONTHLY rate (%), not total-for-period. Capped at 7% by the check below.';

-- Old (retired) plans may still have rate_percent up to 10 from the
-- previous model — cap them first or the new CHECK constraint fails.
update investment_plans set rate_percent = 7 where rate_percent > 7;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'investment_plans_rate_check') then
    alter table investment_plans drop constraint investment_plans_rate_check;
  end if;
  alter table investment_plans add constraint investment_plans_rate_check check (rate_percent >= 0 and rate_percent <= 7);
end $$;

-- Retire the old duration-baked plans, replace with a clean 5-tier
-- rate ladder. Existing user_investments keep their own snapshot
-- (name/rate/duration) so nothing already running is affected.
update investment_plans set is_active = false;

insert into investment_plans (name, icon, duration_months, min_amount, rate_percent, vip_tier, task_limit, multiplier, sort_order, is_active)
values
  ('Bronze',   '🌱', null, 50000,    4,   'silver',   5,  1.05, 1, true),
  ('Silver',   '🌿', null, 100000,   5,   'silver',   8,  1.10, 2, true),
  ('Gold',     '🍀', null, 300000,   5.5, 'gold',     12, 1.15, 3, true),
  ('Platinum', '💎', null, 1000000,  6,   'platinum', 20, 1.25, 4, true),
  ('Diamond',  '👑', null, 2000000,  7,   'legend',   null,1.50, 5, true)
on conflict (name) do update set
  min_amount   = excluded.min_amount,
  rate_percent = excluded.rate_percent,
  vip_tier     = excluded.vip_tier,
  task_limit   = excluded.task_limit,
  multiplier   = excluded.multiplier,
  is_active    = true,
  duration_months = null;

-- ── 2. user_investments: track locked task earnings ────────────
alter table user_investments add column if not exists locked_task_earnings integer not null default 0;

-- ── 3. buy_investment_plan: duration is now a parameter, monthly-rate math ──
drop function if exists buy_investment_plan(uuid, uuid, integer);
drop function if exists buy_investment_plan(uuid, uuid, integer, integer);

create or replace function buy_investment_plan(
  p_user_id         uuid,
  p_plan_id         uuid,
  p_amount          integer,
  p_duration_months integer
) returns uuid language plpgsql security definer as $$
declare
  v_plan          investment_plans%rowtype;
  v_profit        integer;
  v_total         integer;
  v_investment_id uuid;
  v_ref1          uuid;
  v_ref2          uuid;
  v_ref1_rate     numeric;
  v_ref2_rate     numeric;
  v_c1            integer;
  v_c2            integer;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  if p_duration_months not in (1, 3, 6, 12) then
    raise exception 'Lockup period must be 1, 3, 6 or 12 months';
  end if;

  select * into v_plan from investment_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Plan not found or inactive';
  end if;

  if p_amount < v_plan.min_amount then
    raise exception 'Amount below plan minimum of %', v_plan.min_amount;
  end if;

  v_profit := floor(p_amount * v_plan.rate_percent / 100 * p_duration_months);
  v_total  := p_amount + v_profit;

  insert into user_investments (
    user_id, plan_id, plan_name, plan_icon, amount, rate_percent,
    duration_months, vip_tier, task_limit, multiplier,
    expected_profit, expected_total, starts_at, ends_at
  ) values (
    p_user_id, v_plan.id, v_plan.name, v_plan.icon, p_amount, v_plan.rate_percent,
    p_duration_months, v_plan.vip_tier, v_plan.task_limit, v_plan.multiplier,
    v_profit, v_total, now(), now() + (p_duration_months || ' months')::interval
  ) returning id into v_investment_id;

  -- Referral commissions — funded from this purchase only, 2 levels.
  select value::numeric into v_ref1_rate from settings where key = 'ref1_rate';
  select value::numeric into v_ref2_rate from settings where key = 'ref2_rate';
  v_ref1_rate := coalesce(v_ref1_rate, 10);
  v_ref2_rate := coalesce(v_ref2_rate, 5);

  select referred_by into v_ref1 from profiles where id = p_user_id;
  if v_ref1 is not null then
    v_c1 := floor(p_amount * v_ref1_rate / 100);
    update profiles set balance = balance + v_c1, total_earned = total_earned + v_c1
      where id = v_ref1;
    insert into transactions (user_id, amount, type, description)
      values (v_ref1, v_c1, 'referral', 'L1 referral (10%) – ' || v_plan.name || ' plan');

    select referred_by into v_ref2 from profiles where id = v_ref1;
    if v_ref2 is not null then
      v_c2 := floor(p_amount * v_ref2_rate / 100);
      update profiles set balance = balance + v_c2, total_earned = total_earned + v_c2
        where id = v_ref2;
      insert into transactions (user_id, amount, type, description)
        values (v_ref2, v_c2, 'referral', 'L2 referral (5%) – ' || v_plan.name || ' plan');
    end if;
  end if;

  return v_investment_id;
end;
$$;

grant execute on function buy_investment_plan(uuid, uuid, integer, integer) to authenticated;

-- ── 4. reinvest_balance: roll matured funds into a new plan, no new payment ──
drop function if exists reinvest_balance(uuid, uuid, integer, integer);

create or replace function reinvest_balance(
  p_user_id         uuid,
  p_plan_id         uuid,
  p_amount          integer,
  p_duration_months integer
) returns uuid language plpgsql security definer as $$
declare
  v_plan          investment_plans%rowtype;
  v_profit        integer;
  v_total         integer;
  v_investment_id uuid;
  v_balance       integer;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  if p_duration_months not in (1, 3, 6, 12) then
    raise exception 'Lockup period must be 1, 3, 6 or 12 months';
  end if;

  select balance into v_balance from profiles where id = p_user_id for update;
  if v_balance < p_amount then
    raise exception 'Insufficient balance to reinvest';
  end if;

  select * into v_plan from investment_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Plan not found or inactive';
  end if;

  if p_amount < v_plan.min_amount then
    raise exception 'Amount below plan minimum of %', v_plan.min_amount;
  end if;

  v_profit := floor(p_amount * v_plan.rate_percent / 100 * p_duration_months);
  v_total  := p_amount + v_profit;

  update profiles set balance = balance - p_amount where id = p_user_id;
  insert into transactions (user_id, amount, type, description)
    values (p_user_id, -p_amount, 'investment', 'Reinvested into ' || v_plan.name || ' plan');

  insert into user_investments (
    user_id, plan_id, plan_name, plan_icon, amount, rate_percent,
    duration_months, vip_tier, task_limit, multiplier,
    expected_profit, expected_total, starts_at, ends_at
  ) values (
    p_user_id, v_plan.id, v_plan.name, v_plan.icon, p_amount, v_plan.rate_percent,
    p_duration_months, v_plan.vip_tier, v_plan.task_limit, v_plan.multiplier,
    v_profit, v_total, now(), now() + (p_duration_months || ' months')::interval
  ) returning id into v_investment_id;

  return v_investment_id;
end;
$$;

grant execute on function reinvest_balance(uuid, uuid, integer, integer) to authenticated;

-- ── 5. extend_investment: push out maturity on an active plan ──
drop function if exists extend_investment(uuid, uuid, integer);

create or replace function extend_investment(
  p_user_id           uuid,
  p_investment_id     uuid,
  p_additional_months integer
) returns void language plpgsql security definer as $$
declare
  v_inv user_investments%rowtype;
  v_new_total_months integer;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  if p_additional_months <= 0 then
    raise exception 'Additional months must be positive';
  end if;

  select * into v_inv from user_investments
    where id = p_investment_id and user_id = p_user_id and status = 'active' for update;
  if not found then
    raise exception 'Active investment not found';
  end if;

  v_new_total_months := v_inv.duration_months + p_additional_months;

  update user_investments
    set duration_months = v_new_total_months,
        ends_at         = v_inv.starts_at + (v_new_total_months || ' months')::interval,
        expected_profit = floor(v_inv.amount * v_inv.rate_percent / 100 * v_new_total_months),
        expected_total  = v_inv.amount + floor(v_inv.amount * v_inv.rate_percent / 100 * v_new_total_months)
    where id = p_investment_id;
end;
$$;

grant execute on function extend_investment(uuid, uuid, integer) to authenticated;

-- ── 6. complete_task: earnings now LOCK against the best active plan ──
create or replace function complete_task(p_user_id uuid, p_task_id uuid)
returns void language plpgsql security definer as $$
declare
  v_reward_base   integer;
  v_reward        integer;
  v_task_title    text;
  v_status        text;
  v_investment_id uuid;
  v_multiplier    numeric;
  v_task_limit    integer;
  v_today_count   integer;
begin
  select reward, title, status into v_reward_base, v_task_title, v_status
    from tasks where id = p_task_id for update;

  if v_status <> 'active' then
    raise exception 'Task is not active';
  end if;

  -- Best active plan (highest multiplier) drives payout level AND
  -- receives the (locked) earning.
  select id, multiplier, task_limit into v_investment_id, v_multiplier, v_task_limit
    from user_investments
    where user_id = p_user_id and status = 'active'
    order by multiplier desc
    limit 1;

  if v_investment_id is null then
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

  -- Locked, not withdrawable yet — released at plan maturity.
  update user_investments set locked_task_earnings = locked_task_earnings + v_reward
    where id = v_investment_id;

  update profiles
    set total_earned = total_earned + v_reward,   -- lifetime stat, not spendable balance
        tasks_done   = tasks_done + 1
    where id = p_user_id;

  insert into transactions (user_id, amount, type, description)
    values (p_user_id, v_reward, 'task_locked', v_task_title || ' (×' || v_multiplier || ', locked until plan matures)');

  update tasks
    set completions = completions + 1,
        used = used + v_reward,
        status = case when (completions + 1) >= limit_count then 'completed' else status end
    where id = p_task_id;
end;
$$;

-- ── 7. mature_due_investments: release principal + profit + locked task earnings ──
create or replace function mature_due_investments(p_user_id uuid)
returns integer language plpgsql security definer as $$
declare
  v_count  integer := 0;
  v_inv    record;
  v_payout integer;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  for v_inv in
    select * from user_investments
    where user_id = p_user_id and status = 'active' and ends_at <= now()
    for update
  loop
    v_payout := v_inv.expected_total + v_inv.locked_task_earnings;

    update profiles
      set balance      = balance + v_payout,
          total_earned = total_earned + v_inv.expected_profit  -- task earnings already counted at completion time
      where id = p_user_id;

    update user_investments
      set status = 'paid_out', credited_at = now()
      where id = v_inv.id;

    insert into transactions (user_id, amount, type, description)
      values (p_user_id, v_payout, 'investment',
        v_inv.plan_name || ' plan matured' ||
        (case when v_inv.locked_task_earnings > 0 then ' (incl. ' || v_inv.locked_task_earnings || ' locked task earnings)' else '' end));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
