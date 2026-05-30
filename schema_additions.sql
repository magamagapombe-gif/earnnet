-- ============================================================
--  EarnNet – Schema additions
--  Run this in Supabase SQL Editor AFTER the original schema.sql
-- ============================================================

-- ── Deposits ──────────────────────────────────────────────────
create table if not exists deposits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  amount        integer not null,
  method        text not null,     -- mtn | airtel
  phone_number  text not null,
  status        text not null default 'pending', -- pending | confirmed | rejected
  requested_at  timestamptz default now(),
  confirmed_at  timestamptz
);

alter table deposits enable row level security;

create policy "Users can read own deposits"
  on deposits for select using (auth.uid() = user_id);

create policy "Users can insert own deposits"
  on deposits for insert with check (auth.uid() = user_id);

create policy "Service role full access on deposits"
  on deposits for all using (auth.role() = 'service_role');

-- ── Activation requests ───────────────────────────────────────
create table if not exists activation_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  method        text not null,
  phone_number  text not null,
  status        text not null default 'pending', -- pending | confirmed | rejected
  requested_at  timestamptz default now(),
  confirmed_at  timestamptz
);

alter table activation_requests enable row level security;

create policy "Users can read own activation requests"
  on activation_requests for select using (auth.uid() = user_id);

create policy "Users can insert own activation requests"
  on activation_requests for insert with check (auth.uid() = user_id);

create policy "Service role full access on activation_requests"
  on activation_requests for all using (auth.role() = 'service_role');

-- ── Add 'activated' column to profiles (if not present) ───────
alter table profiles add column if not exists activated boolean default false;

-- ── Add missing settings ───────────────────────────────────────
insert into settings (key, value) values
  ('min_deposit',     '2000'),
  ('activation_fee',  '5000')
on conflict (key) do nothing;

-- ── Function: admin_confirm_deposit ───────────────────────────
create or replace function admin_confirm_deposit(p_deposit_id uuid)
returns void language plpgsql security definer as $$
declare
  v_user_id uuid;
  v_amount  integer;
begin
  select user_id, amount into v_user_id, v_amount
    from deposits where id = p_deposit_id;

  update deposits
    set status = 'confirmed', confirmed_at = now()
    where id = p_deposit_id;

  update profiles
    set balance = balance + v_amount,
        total_earned = total_earned + v_amount
    where id = v_user_id;

  insert into transactions (user_id, amount, type, description)
    values (v_user_id, v_amount, 'deposit', 'Deposit confirmed');
end;
$$;

-- ── Function: admin_confirm_activation ────────────────────────
create or replace function admin_confirm_activation(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
    from activation_requests where id = p_request_id;

  update activation_requests
    set status = 'confirmed', confirmed_at = now()
    where id = p_request_id;

  update profiles set activated = true where id = v_user_id;

  insert into transactions (user_id, amount, type, description)
    values (v_user_id, 0, 'activation', 'Account activated');
end;
$$;

grant execute on function admin_confirm_deposit(uuid)     to service_role;
grant execute on function admin_confirm_activation(uuid)  to service_role;
