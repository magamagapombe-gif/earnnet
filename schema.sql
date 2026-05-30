-- ============================================================
--  EarnNet – Supabase Schema
--  Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Settings table ────────────────────────────────────────────
create table if not exists settings (
  key   text primary key,
  value text not null
);

-- Default platform settings
insert into settings (key, value) values
  ('min_withdrawal', '5000'),
  ('max_withdrawal', '1000000'),
  ('signup_bonus',   '2000'),
  ('streak_bonus',   '5000'),
  ('ref1_rate',      '10'),
  ('ref2_rate',      '5'),
  ('ref3_rate',      '2'),
  ('platform_fee',   '15')
on conflict (key) do nothing;

-- ── Profiles ──────────────────────────────────────────────────
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  phone         text unique,
  initials      text,
  balance       integer not null default 0,
  total_earned  integer not null default 0,
  tasks_done    integer not null default 0,
  referrals     integer not null default 0,
  streak_days   integer not null default 0,
  last_login    date,
  referred_by   uuid references profiles(id),
  referral_code text unique default upper(substring(gen_random_uuid()::text, 1, 6)),
  kyc_verified  boolean default false,
  status        text not null default 'active', -- active | suspended | pending_kyc
  created_at    timestamptz default now()
);

-- Enable Row Level Security
alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- Admin can read all profiles (via service role key, not anon)
create policy "Service role full access on profiles"
  on profiles for all using (auth.role() = 'service_role');

-- ── Tasks ─────────────────────────────────────────────────────
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  business     text not null,
  description  text,
  type         text not null default 'social', -- social | survey | install | review
  category     text not null default 'social',
  icon         text default '📋',
  color        text default '#E1F5EE',
  text_color   text default '#0F6E56',
  time_est     text default '5 min',
  reward       integer not null,
  budget       integer not null default 0,
  used         integer not null default 0,
  limit_count  integer not null default 500,
  completions  integer not null default 0,
  status       text not null default 'active', -- active | paused | completed
  created_at   timestamptz default now()
);

alter table tasks enable row level security;

-- Anyone can read active tasks
create policy "Anyone can read active tasks"
  on tasks for select using (status = 'active');

create policy "Service role full access on tasks"
  on tasks for all using (auth.role() = 'service_role');

-- ── Task completions ──────────────────────────────────────────
create table if not exists task_completions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  task_id    uuid not null references tasks(id) on delete cascade,
  completed_at timestamptz default now(),
  unique(user_id, task_id)
);

alter table task_completions enable row level security;

create policy "Users can read own completions"
  on task_completions for select using (auth.uid() = user_id);

create policy "Service role full access on task_completions"
  on task_completions for all using (auth.role() = 'service_role');

-- ── Transactions ──────────────────────────────────────────────
create table if not exists transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  amount      integer not null, -- positive = credit, negative = debit
  type        text not null,    -- task | referral | withdrawal | bonus | streak
  description text,
  created_at  timestamptz default now()
);

alter table transactions enable row level security;

create policy "Users can read own transactions"
  on transactions for select using (auth.uid() = user_id);

create policy "Service role full access on transactions"
  on transactions for all using (auth.role() = 'service_role');

-- ── Withdrawals ───────────────────────────────────────────────
create table if not exists withdrawals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  amount        integer not null,
  method        text not null,   -- mtn | airtel
  phone_number  text not null,
  status        text not null default 'pending', -- pending | processing | paid | rejected
  livepay_ref   text,
  requested_at  timestamptz default now(),
  processed_at  timestamptz
);

alter table withdrawals enable row level security;

create policy "Users can read own withdrawals"
  on withdrawals for select using (auth.uid() = user_id);

create policy "Users can insert own withdrawals"
  on withdrawals for insert with check (auth.uid() = user_id);

create policy "Service role full access on withdrawals"
  on withdrawals for all using (auth.role() = 'service_role');

-- ── Businesses ────────────────────────────────────────────────
create table if not exists businesses (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  email     text,
  credit    integer not null default 0,
  spent     integer not null default 0,
  tasks     integer not null default 0,
  verified  boolean default false,
  joined_at timestamptz default now()
);

alter table businesses enable row level security;

create policy "Service role full access on businesses"
  on businesses for all using (auth.role() = 'service_role');

-- ── Referrals lookup ──────────────────────────────────────────
-- (stored via referred_by on profiles; this view makes it easy to query)
create or replace view referral_tree as
  select
    r.id             as referrer_id,
    r.name           as referrer_name,
    u.id             as referred_id,
    u.name           as referred_name,
    u.created_at     as joined_at
  from profiles u
  join profiles r on u.referred_by = r.id;

-- ── Function: create profile after sign up ────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_name       text;
  v_phone      text;
  v_ref_code   text;
  v_referrer   uuid;
  v_signup_bonus integer;
begin
  v_name  := new.raw_user_meta_data->>'name';
  v_phone := new.raw_user_meta_data->>'phone';
  v_ref_code := new.raw_user_meta_data->>'referral_code';

  -- Look up referrer
  if v_ref_code is not null and v_ref_code <> '' then
    select id into v_referrer from profiles where referral_code = upper(v_ref_code) limit 1;
  end if;

  -- Get signup bonus
  select value::integer into v_signup_bonus from settings where key = 'signup_bonus';
  v_signup_bonus := coalesce(v_signup_bonus, 2000);

  -- Create profile
  insert into profiles (id, name, phone, initials, balance, total_earned, referred_by)
  values (
    new.id,
    v_name,
    v_phone,
    upper(substring(v_name, 1, 1) || coalesce(split_part(v_name, ' ', 2), '?')),
    v_signup_bonus,
    v_signup_bonus,
    v_referrer
  );

  -- Record signup bonus transaction
  insert into transactions (user_id, amount, type, description)
  values (new.id, v_signup_bonus, 'bonus', 'Welcome bonus');

  -- Credit referrer commission (level 1)
  if v_referrer is not null then
    declare
      v_ref1_rate integer;
      v_commission integer;
    begin
      select value::integer into v_ref1_rate from settings where key = 'ref1_rate';
      v_commission := floor(v_signup_bonus * coalesce(v_ref1_rate, 10) / 100);
      update profiles set balance = balance + v_commission, total_earned = total_earned + v_commission, referrals = referrals + 1
        where id = v_referrer;
      insert into transactions (user_id, amount, type, description)
        values (v_referrer, v_commission, 'referral', 'Referral commission – ' || v_name);
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Function: complete_task ────────────────────────────────────
create or replace function complete_task(p_user_id uuid, p_task_id uuid)
returns void language plpgsql security definer as $$
declare
  v_reward     integer;
  v_task_title text;
  v_status     text;
  v_ref1       uuid;
  v_ref2       uuid;
  v_ref1_rate  integer;
  v_ref2_rate  integer;
  v_ref3_rate  integer;
  v_c1         integer;
  v_c2         integer;
  v_c3         integer;
  v_ref3       uuid;
begin
  -- Lock & validate task
  select reward, title, status into v_reward, v_task_title, v_status
    from tasks where id = p_task_id for update;

  if v_status <> 'active' then
    raise exception 'Task is not active';
  end if;

  -- Insert completion (will fail on duplicate due to unique constraint)
  insert into task_completions (user_id, task_id) values (p_user_id, p_task_id);

  -- Credit user
  update profiles
    set balance = balance + v_reward,
        total_earned = total_earned + v_reward,
        tasks_done = tasks_done + 1
    where id = p_user_id;

  insert into transactions (user_id, amount, type, description)
    values (p_user_id, v_reward, 'task', v_task_title);

  -- Update task counters
  update tasks
    set completions = completions + 1,
        used = used + v_reward,
        status = case when (completions + 1) >= limit_count then 'completed' else status end
    where id = p_task_id;

  -- Referral commissions
  select value::integer into v_ref1_rate from settings where key = 'ref1_rate';
  select value::integer into v_ref2_rate from settings where key = 'ref2_rate';
  select value::integer into v_ref3_rate from settings where key = 'ref3_rate';

  select referred_by into v_ref1 from profiles where id = p_user_id;
  if v_ref1 is not null then
    v_c1 := floor(v_reward * coalesce(v_ref1_rate, 10) / 100);
    update profiles set balance = balance + v_c1, total_earned = total_earned + v_c1 where id = v_ref1;
    insert into transactions (user_id, amount, type, description)
      values (v_ref1, v_c1, 'referral', 'L1 commission – ' || v_task_title);

    select referred_by into v_ref2 from profiles where id = v_ref1;
    if v_ref2 is not null then
      v_c2 := floor(v_reward * coalesce(v_ref2_rate, 5) / 100);
      update profiles set balance = balance + v_c2, total_earned = total_earned + v_c2 where id = v_ref2;
      insert into transactions (user_id, amount, type, description)
        values (v_ref2, v_c2, 'referral', 'L2 commission – ' || v_task_title);

      select referred_by into v_ref3 from profiles where id = v_ref2;
      if v_ref3 is not null then
        v_c3 := floor(v_reward * coalesce(v_ref3_rate, 2) / 100);
        update profiles set balance = balance + v_c3, total_earned = total_earned + v_c3 where id = v_ref3;
        insert into transactions (user_id, amount, type, description)
          values (v_ref3, v_c3, 'referral', 'L3 commission – ' || v_task_title);
      end if;
    end if;
  end if;
end;
$$;

-- ── Function: request_withdrawal ──────────────────────────────
create or replace function request_withdrawal(
  p_user_id     uuid,
  p_amount      integer,
  p_method      text,
  p_phone_number text
) returns void language plpgsql security definer as $$
declare
  v_balance    integer;
  v_min        integer;
  v_max        integer;
begin
  select value::integer into v_min from settings where key = 'min_withdrawal';
  select value::integer into v_max from settings where key = 'max_withdrawal';
  v_min := coalesce(v_min, 5000);
  v_max := coalesce(v_max, 1000000);

  select balance into v_balance from profiles where id = p_user_id for update;

  if p_amount < v_min then raise exception 'Amount below minimum withdrawal'; end if;
  if p_amount > v_max then raise exception 'Amount above maximum withdrawal'; end if;
  if v_balance < p_amount then raise exception 'Insufficient balance'; end if;

  -- Deduct balance immediately
  update profiles set balance = balance - p_amount where id = p_user_id;

  -- Create withdrawal record
  insert into withdrawals (user_id, amount, method, phone_number)
    values (p_user_id, p_amount, p_method, p_phone_number);

  -- Record debit transaction
  insert into transactions (user_id, amount, type, description)
    values (p_user_id, -p_amount, 'withdrawal', 'Withdrawal via ' || upper(p_method));
end;
$$;

-- ── Function: refund_withdrawal (on rejection) ────────────────
create or replace function refund_withdrawal(p_withdrawal_id uuid)
returns void language plpgsql security definer as $$
declare
  v_user_id uuid;
  v_amount  integer;
begin
  select user_id, amount into v_user_id, v_amount
    from withdrawals where id = p_withdrawal_id;

  update profiles set balance = balance + v_amount where id = v_user_id;

  insert into transactions (user_id, amount, type, description)
    values (v_user_id, v_amount, 'bonus', 'Withdrawal refunded');
end;
$$;

-- ── Function: admin_process_withdrawal ────────────────────────
-- In production, call your payment gateway (LivePay/Flutterwave) here.
-- For now this marks the withdrawal as paid and sets a mock ref.
create or replace function admin_process_withdrawal(p_withdrawal_id uuid)
returns text language plpgsql security definer as $$
declare
  v_ref text;
begin
  v_ref := 'LP-' || upper(substring(gen_random_uuid()::text, 1, 8));

  update withdrawals
    set status = 'paid',
        livepay_ref = v_ref,
        processed_at = now()
    where id = p_withdrawal_id;

  return v_ref;
end;
$$;

-- ── Grants ────────────────────────────────────────────────────
-- Grant execute on RPCs to authenticated users
grant execute on function complete_task(uuid, uuid)           to authenticated;
grant execute on function request_withdrawal(uuid, int, text, text) to authenticated;
-- Admin RPCs use service_role key (called from admin panel only)
grant execute on function admin_process_withdrawal(uuid)      to service_role;
grant execute on function refund_withdrawal(uuid)             to service_role;
