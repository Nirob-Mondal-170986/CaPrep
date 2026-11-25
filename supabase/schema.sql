-- H&A CA Prep: database setup for Supabase
-- Run this whole file once in Supabase: SQL Editor → New query → paste → Run.
-- It creates 3 tables (profiles, progress, activity), security rules, and helper functions.

-- 1. Tables -----------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  subjects    text[] not null default '{}'
);

-- (If you created the tables earlier, this line adds the new column safely.)
alter table public.profiles add column if not exists subjects text[] not null default '{}';

create table if not exists public.progress (
  user_id     uuid not null references auth.users (id) on delete cascade,
  topic_id    text not null,
  paper       text not null,
  chapter     int  not null,
  is_read     boolean not null default false,
  confidence  text check (confidence in ('low', 'medium', 'high')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists activity_user_time on public.activity (user_id, created_at desc);
create index if not exists activity_time on public.activity (created_at desc);

-- 2. Helper functions -------------------------------------------------------

-- Is the signed-in person an admin? (security definer avoids a policy loop)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Used on the sign-up form to tell people a username is already taken.
create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Create a profile row automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Security rules (Row Level Security) -----------------------------------
-- Students see and change only their own rows. Admins can read everyone's.

alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.activity enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- Students may only update their own "last_seen" time and chosen subjects (not username or admin flag).
revoke update on public.profiles from authenticated, anon;
grant update (last_seen, subjects) on public.profiles to authenticated;
drop policy if exists "profiles touch" on public.profiles;
create policy "profiles touch" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "progress read" on public.progress;
create policy "progress read" on public.progress
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "progress insert" on public.progress;
create policy "progress insert" on public.progress
  for insert with check (user_id = auth.uid());
drop policy if exists "progress update" on public.progress;
create policy "progress update" on public.progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "progress delete" on public.progress;
create policy "progress delete" on public.progress
  for delete using (user_id = auth.uid());

drop policy if exists "activity read" on public.activity;
create policy "activity read" on public.activity
  for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "activity insert" on public.activity;
create policy "activity insert" on public.activity
  for insert with check (user_id = auth.uid());

-- 4. Make yourself admin -----------------------------------------------------
-- After you create your own account on the website, run this line
-- (change 'your_username' to the username you registered):
--
--   update public.profiles set is_admin = true where username = 'your_username';
