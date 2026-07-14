-- ============================================================
--  EarnNet – Growth plans + referral rework
--  Run this in Supabase SQL Editor AFTER schema.sql and
--  schema_additions.sql.
--
--  What this changes:
--   • Adds investment_plans / user_investments (referenced by the
--     frontend but never defined anywhere in the repo).
--   • Removes the sign-up bonus and its referral commission.
--   • Removes the 3-level referral commission paid on every task
--     completion.
--   • Adds a 2-level referral commission paid ONLY when a user
--     buys a growth plan: 10% of the amount to their direct
--     referrer, 5% of the amount to that referrer's referrer.
-- ============================================================

-- ── investment_plans ─────────────────────────────────────────
-- Each row is one buyable plan. Users type a custom amount ≥
-- min_amount when buying — the plan itself does not fix the
-- amount. rate_percent is the TOTAL return for the whole period
-- (not daily). task_limit/multiplier/vip_tier drive the same
-- task-unlock perks the old hard-coded PLAN_TIERS gave.
create table if not exists investment_plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null
);

-- The table may already exist from an earlier/partial attempt with a
-- different column set — add whatever's missing rather than assuming
-- a fresh CREATE TABLE ran.
alter table investment_plans add column if not exists icon             text default '🌱';
alter table investment_plans add column if not exists duration_months  integer;
alter table investment_plans add column if not exists min_amount      integer;
alter table investment_plans add column if not exists rate_percent    numeric;
alter table investment_plans add column if not exists vip_tier        text default 'silver';
alter table investment_plans add column if not exists task_limit      integer;
alter table investment_plans add column if not exists multiplier      numeric default 1.10;
alter table investment_plans add column if not exists sort_order      integer default 0;
alter table investment_plans add column if not exists is_active       boolean default true;
alter table investment_plans add column if not exists created_at      timestamptz default now();

-- Retire columns from an old/broken version of this table (superseded
-- by min_amount / rate_percent / duration_months above).
alter table investment_plans drop column if exists amount;
alter table investment_plans drop column if exists daily_rate;
alter table investment_plans drop column if exists duration_days;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'investment_plans_rate_check') then
    alter table investment_plans add constraint investment_plans_rate_check check (rate_percent >= 0 and rate_percent <= 10);
  end if;
end $$;

alter table investment_plans enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'investment_plans_name_key') then
    alter table investment_plans add constraint investment_plans_name_key unique (name);
  end if;
end $$;

drop policy if exists "Anyone can read active plans" on investment_plans;
create policy "Anyone can read active plans"
  on investment_plans for select using (is_active = true);

drop policy if exists "Service role full access on investment_plans" on investment_plans;
create policy "Service role full access on investment_plans"
  on investment_plans for all using (auth.role() = 'service_role');

-- ── user_investments ─────────────────────────────────────────
-- Snapshots the plan's terms at purchase time so later edits to
-- investment_plans never change an investment already in flight.
create table if not exists user_investments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  plan_id         uuid not null references investment_plans(id)
);

alter table user_investments add column if not exists plan_name       text;
alter table user_investments add column if not exists plan_icon       text;
alter table user_investments add column if not exists amount          integer;
alter table user_investments add column if not exists rate_percent    numeric;
alter table user_investments add column if not exists duration_months integer;
alter table user_investments add column if not exists vip_tier        text;
alter table user_investments add column if not exists task_limit      integer;
alter table user_investments add column if not exists multiplier      numeric default 1.10;
alter table user_investments add column if not exists expected_profit integer;
alter table user_investments add column if not exists expected_total  integer;
alter table user_investments add column if not exists status          text default 'active';
alter table user_investments add column if not exists starts_at       timestamptz default now();
alter table user_investments add column if not exists ends_at         timestamptz;
alter table user_investments add column if not exists credited_at     timestamptz;
alter table user_investments add column if not exists created_at      timestamptz default now();

-- Retire columns from an old/broken version of this table.
alter table user_investments drop column if exists daily_rate;
alter table user_investments drop column if exists duration_days;
alter table user_investments drop column if exists locked_profit;
alter table user_investments drop column if exists total_profit;

alter table user_investments enable row level security;

drop policy if exists "Users can read own investments" on user_investments;
create policy "Users can read own investments"
  on user_investments for select using (auth.uid() = user_id);

drop policy if exists "Service role full access on user_investments" on user_investments;
create policy "Service role full access on user_investments"
  on user_investments for all using (auth.role() = 'service_role');

-- ── Seed plans ────────────────────────────────────────────────
-- Starting set (8 of the 10 allowed) — adjust freely from the
-- admin panel. Minimums step up by period; the 1-year plan's
-- minimum is fixed at 2,000,000 as requested. Highest rate is 10%.
insert into investment_plans (name, icon, duration_months, min_amount, rate_percent, vip_tier, task_limit, multiplier, sort_order) values
  ('Starter',      '🌱', 1,   50000,   3, 'silver',   8,    1.10, 1),
  ('Basic',        '🌿', 1,   300000,  4, 'silver',   8,    1.10, 2),
  ('Bronze',       '🌳', 3,   600000,  5, 'gold',     15,   1.20, 3),
  ('Silver Plan',  '🌳', 3,   1000000, 6, 'gold',     15,   1.20, 4),
  ('Gold Plan',    '💎', 6,   1500000, 7, 'platinum', 25,   1.35, 5),
  ('Platinum Plan','💎', 6,   1800000, 8, 'platinum', 25,   1.35, 6),
  ('Elite',        '👑', 12,  2000000, 9, 'legend',   null, 2.00, 7),
  ('Legend',       '👑', 12,  3000000, 10,'legend',   null, 2.00, 8)
on conflict (name) do nothing;

-- ── Remove sign-up bonus + its referral ─────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_name       text;
  v_phone      text;
  v_ref_code   text;
  v_referrer   uuid;
begin
  v_name  := new.raw_user_meta_data->>'name';
  v_phone := new.raw_user_meta_data->>'phone';
  v_ref_code := new.raw_user_meta_data->>'referral_code';

  if v_ref_code is not null and v_ref_code <> '' then
    select id into v_referrer from profiles where referral_code = upper(v_ref_code) limit 1;
  end if;

  -- Create profile — no sign-up bonus, no referral commission on sign-up.
  -- Referral commissions now happen only in buy_investment_plan().
  insert into profiles (id, name, phone, initials, balance, total_earned, referred_by)
  values (
    new.id,
    v_name,
    v_phone,
    upper(substring(v_name, 1, 1) || coalesce(split_part(v_name, ' ', 2), '?')),
    0,
    0,
    v_referrer
  );

  return new;
end;
$$;

-- ── Remove task-completion referral commissions ─────────────────
-- Referral bonuses now come exclusively from growth-plan purchases.
create or replace function complete_task(p_user_id uuid, p_task_id uuid)
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

  insert into task_completions (user_id, task_id) values (p_user_id, p_task_id);

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

-- ── Function: buy_investment_plan ────────────────────────────
-- Pays the 2-level referral commission out of the amount the
-- BUYER pays: level-1 referrer gets ref1_rate% (default 10%),
-- level-2 referrer (the level-1 referrer's own referrer) gets
-- ref2_rate% (default 5%). No level 3.
create or replace function buy_investment_plan(
  p_user_id uuid,
  p_plan_id uuid,
  p_amount  integer
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

  select * into v_plan from investment_plans where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'Plan not found or inactive';
  end if;

  if p_amount < v_plan.min_amount then
    raise exception 'Amount below plan minimum of %', v_plan.min_amount;
  end if;

  v_profit := floor(p_amount * v_plan.rate_percent / 100);
  v_total  := p_amount + v_profit;

  insert into user_investments (
    user_id, plan_id, plan_name, plan_icon, amount, rate_percent,
    duration_months, vip_tier, task_limit, multiplier,
    expected_profit, expected_total, starts_at, ends_at
  ) values (
    p_user_id, v_plan.id, v_plan.name, v_plan.icon, p_amount, v_plan.rate_percent,
    v_plan.duration_months, v_plan.vip_tier, v_plan.task_limit, v_plan.multiplier,
    v_profit, v_total, now(), now() + (v_plan.duration_months || ' months')::interval
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

-- ── Function: mature_due_investments ─────────────────────────
create or replace function mature_due_investments(p_user_id uuid)
returns integer language plpgsql security definer as $$
declare
  v_count integer := 0;
  v_inv   record;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  for v_inv in
    select * from user_investments
    where user_id = p_user_id and status = 'active' and ends_at <= now()
    for update
  loop
    update profiles
      set balance = balance + v_inv.expected_total,
          total_earned = total_earned + v_inv.expected_profit
      where id = p_user_id;

    update user_investments
      set status = 'paid_out', credited_at = now()
      where id = v_inv.id;

    insert into transactions (user_id, amount, type, description)
      values (p_user_id, v_inv.expected_total, 'investment', v_inv.plan_name || ' plan matured');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ── Settings cleanup ──────────────────────────────────────────
delete from settings where key in ('signup_bonus', 'ref3_rate');

update settings set value = '10' where key = 'ref1_rate';
update settings set value = '5'  where key = 'ref2_rate';

-- ── Grants ────────────────────────────────────────────────────
grant execute on function buy_investment_plan(uuid, uuid, integer) to authenticated;
grant execute on function mature_due_investments(uuid)              to authenticated;
