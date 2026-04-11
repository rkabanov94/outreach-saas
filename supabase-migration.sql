-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- profiles table — extends Supabase's built-in auth.users
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  plan                   text not null default 'demo' check (plan in ('demo', 'paid')),
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- Row-level security: users can only read their own row
alter table public.profiles enable row level security;

create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

-- Service role (used by the backend) bypasses RLS automatically
