-- ============================================================
--  EarnNet — Growth Plans v2 migration
--  Run this in Supabase SQL Editor AFTER schema.sql + schema_additions.sql
--  (safe to re-run — uses IF NOT EXISTS / OR REPLACE throughout)
--
--  What this changes:
--   • 10 growth plans, each with a MINIMUM buy-in (user can put in
--     more) and a total-return % per period: 1 / 3 / 6 / 12 months.
--     Highest plan = 10% total return, only on the 12-month period,
--     minimum 2,000,000 UGX.
--   • Plans now also drive task-tier limits, reward multiplier and
--     VIP label (same idea as the old Starter→Legend system, just
--     10 tiers instead of 5).
--   • No signup bonus. Referral commission ONLY fires once — when a
--     user buys their first ("initial") growth plan — and only two
--     levels deep: the direct referrer gets 10% of what was paid,
--     and THEIR referrer gets 5% when that happens.
-- ============================================================

-- ── investment_plans: add the new columns we need ──────────────
alter table investment_plans add column if not exists min_amount integer;
alter table investment_plans add column if not exists rate_1m    numeric(7,4);
alter table investment_plans add column if not exists rate_3m    numeric(7,4);
alter table investment_plans add column if not exists rate_6m    numeric(7,4);
alter table investment_plans add column if not exists rate_12m   numeric(7,4);
alter table investment_plans add column if not exists task_limit integer;      -- null = unlimited
alter table investment_plans add column if not exists multiplier numeric(4,2);

-- Retire any old plan rows (kept, not deleted, so historical
-- user_investments FKs referencing them stay intact)
update investment_plans set is_active = false;

-- ── Seed the 10 growth plans ────────────────────────────────────
-- amount / daily_rate / duration_days are filled too, for backward
-- compatibility with any code still reading those legacy columns
-- (daily_rate here = the 1-month rate spread over 30 days).
insert into investment_plans
  (name, amount, min_amount, daily_rate, duration_days,
   rate_1m, rate_3m, rate_6m, rate_12m, task_limit, multiplier,
   sort_order, is_active)
values
  ('Starter', 20000,    20000,    0.015/30, 30, 0.015, 0.030, 0.050, 0.080, 8,    1.10, 1,  true),
  ('Bronze',  50000,    50000,    0.017/30, 30, 0.017, 0.033, 0.054, 0.083, 10,   1.13, 2,  true),
  ('Silver',  100000,   100000,   0.019/30, 30, 0.019, 0.036, 0.058, 0.086, 12,   1.16, 3,  true),
  ('Growth',  200000,   200000,   0.021/30, 30, 0.021, 0.039, 0.062, 0.089, 15,   1.20, 4,  true),
  ('Advance', 350000,   350000,   0.023/30, 30, 0.023, 0.042, 0.066, 0.091, 18,   1.25, 5,  true),
  ('Premium', 500000,   500000,   0.025/30, 30, 0.025, 0.045, 0.070, 0.093, 22,   1.30, 6,  true),
  ('Pro',     750000,   750000,   0.027/30, 30, 0.027, 0.048, 0.075, 0.095, 28,   1.40, 7,  true),
  ('Elite',   1000000,  1000000,  0.029/30, 30, 0.029, 0.051, 0.080, 0.097, 35,   1.50, 8,  true),
  ('Diamond', 1500000,  1500000,  0.032/30, 30, 0.032, 0.055, 0.085, 0.099, 45,   1.75, 9,  true),
  ('Legend',  2000000,  2000000,  0.035/30, 30, 0.035, 0.060, 0.090, 0.100, null, 2.00, 10, true);

-- ── user_investments: record which period (in months) was chosen ─
alter table user_investments add column if not exists duration_months integer;

-- ── Settings: no signup bonus, two-level referral only ───────────
delete from settings where key in ('signup_bonus', 'ref3_rate');
insert into settings (key, value) values
  ('ref1_rate', '10'),   -- % of the plan amount, paid to the direct referrer
  ('ref2_rate', '5')     -- % of the plan amount, paid to the referrer's referrer
on conflict (key) do update set value = excluded.value;

-- ── Function: handle_new_user — no welcome bonus anymore ─────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_name     text;
  v_phone    text;
  v_ref_code text;
  v_referrer uuid;
begin
  v_name     := new.raw_user_meta_data->>'name';
  v_phone    := new.raw_user_meta_data->>'phone';
  v_ref_code := new.raw_user_meta_data->>'referral_code';

  if v_ref_code is not null and v_ref_code <> '' then
    select id into v_referrer from profiles where referral_code = upper(v_ref_code) limit 1;
  end if;

  insert into profiles (id, name, phone, initials, balance, total_earned, referred_by)
  values (
    new.id, v_name, v_phone,
    upper(substring(v_name, 1, 1) || coalesce(split_part(v_name, ' ', 2), '?')),
    0, 0, v_referrer
  );

  return new;
end;
$$;

-- ── Function: complete_task — no referral cut, task pay only ─────
alter table task_completions add column if not exists proof_url text;

drop function if exists complete_task(uuid, uuid);
drop function if exists complete_task(uuid, uuid, text);

create or replace function complete_task(p_user_id uuid, p_task_id uuid, p_proof_url text default null)
returns void language plpgsql security definer as $$
declare
  v_reward     integer;
  v_task_title text;
  v_status     text;
begin
  select reward, title, status into v_reward, v_task_title, v_status
    from tasks where id = p_task_id for update;

  if v_status <> 'active' then
    raise exception 'Task is not active';
  end if;

  insert into task_completions (user_id, task_id, proof_url) values (p_user_id, p_task_id, p_proof_url);

  update profiles
    set balance = balance + v_reward,
        total_earned = total_earned + v_reward,
        tasks_done = tasks_done + 1
    where id = p_user_id;

  insert into transactions (user_id, amount, type, description)
    values (p_user_id, v_reward, 'task', v_task_title);

  update tasks
    set completions = completions + 1,
        used = used + v_reward,
        status = case when (completions + 1) >= limit_count then 'completed' else status end
    where id = p_task_id;
end;
$$;

grant execute on function complete_task(uuid, uuid, text) to authenticated;

-- ── Function: buy_investment_plan — flexible amount + duration ───
drop function if exists buy_investment_plan(uuid, uuid, integer);

create or replace function buy_investment_plan(
  p_user_id          uuid,
  p_plan_id          uuid,
  p_amount           integer,
  p_duration_months  integer   -- 1, 3, 6 or 12
) returns uuid language plpgsql security definer as $$
declare
  v_plan           record;
  v_rate           numeric;
  v_duration_days  integer;
  v_balance        integer;
  v_investment_id  uuid;
  v_is_first       boolean;
  v_name           text;
  v_ref1           uuid;
  v_ref2           uuid;
  v_ref1_rate      numeric;
  v_ref2_rate      numeric;
  v_c1             integer;
  v_c2             integer;
begin
  select * into v_plan from investment_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Plan not found or inactive';
  end if;

  if p_amount < v_plan.min_amount then
    raise exception '% requires at least % UGX', v_plan.name, v_plan.min_amount;
  end if;

  v_rate := case p_duration_months
    when 1  then v_plan.rate_1m
    when 3  then v_plan.rate_3m
    when 6  then v_plan.rate_6m
    when 12 then v_plan.rate_12m
    else null
  end;
  if v_rate is null then
    raise exception 'Choose a period of 1, 3, 6 or 12 months';
  end if;

  v_duration_days := case p_duration_months
    when 1 then 30 when 3 then 90 when 6 then 180 when 12 then 365
  end;

  select balance into v_balance from profiles where id = p_user_id for update;
  if v_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  -- Referral commission only ever fires on the user's very first plan purchase
  select not exists(select 1 from user_investments where user_id = p_user_id) into v_is_first;

  update profiles set balance = balance - p_amount where id = p_user_id;

  insert into user_investments
    (user_id, plan_id, plan_name, amount, daily_rate, duration_days, duration_months, status, starts_at, matures_at)
  values
    (p_user_id, p_plan_id, v_plan.name, p_amount, v_rate / v_duration_days, v_duration_days, p_duration_months,
     'active', now(), now() + (v_duration_days || ' days')::interval)
  returning id into v_investment_id;

  insert into transactions (user_id, amount, type, description)
    values (p_user_id, -p_amount, 'investment', v_plan.name || ' plan — ' || p_duration_months || ' month(s)');

  if v_is_first then
    select value::numeric into v_ref1_rate from settings where key = 'ref1_rate';
    select value::numeric into v_ref2_rate from settings where key = 'ref2_rate';
    select name into v_name from profiles where id = p_user_id;

    select referred_by into v_ref1 from profiles where id = p_user_id;
    if v_ref1 is not null then
      v_c1 := floor(p_amount * coalesce(v_ref1_rate, 10) / 100);
      update profiles
        set balance = balance + v_c1, total_earned = total_earned + v_c1, referrals = referrals + 1
        where id = v_ref1;
      insert into transactions (user_id, amount, type, description)
        values (v_ref1, v_c1, 'referral', 'Referral commission — ' || v_name || '''s ' || v_plan.name || ' plan');

      select referred_by into v_ref2 from profiles where id = v_ref1;
      if v_ref2 is not null then
        v_c2 := floor(p_amount * coalesce(v_ref2_rate, 5) / 100);
        update profiles
          set balance = balance + v_c2, total_earned = total_earned + v_c2
          where id = v_ref2;
        insert into transactions (user_id, amount, type, description)
          values (v_ref2, v_c2, 'referral', 'L2 referral commission — ' || v_name || '''s ' || v_plan.name || ' plan');
      end if;
    end if;
  end if;

  return v_investment_id;
end;
$$;

grant execute on function buy_investment_plan(uuid, uuid, integer, integer) to authenticated;

-- ── Function: mature_due_investments — pay out finished plans ────
create or replace function mature_due_investments(p_user_id uuid)
returns integer language plpgsql security definer as $$
declare
  v_count  integer := 0;
  r        record;
  v_payout integer;
begin
  for r in
    select * from user_investments
    where user_id = p_user_id and status = 'active' and matures_at <= now()
  loop
    v_payout := r.amount + floor(r.amount * r.daily_rate * r.duration_days);

    update profiles
      set balance = balance + v_payout,
          total_earned = total_earned + (v_payout - r.amount)
      where id = p_user_id;

    update user_investments set status = 'paid_out' where id = r.id;

    insert into transactions (user_id, amount, type, description)
      values (p_user_id, v_payout, 'investment_profit', r.plan_name || ' plan matured');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function mature_due_investments(uuid) to authenticated;
