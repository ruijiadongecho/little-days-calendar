-- Family Days single-account calendar schema for Supabase.
-- The same account can be signed in on both the parent and child devices.

create extension if not exists pgcrypto;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text not null default '家庭成员', created_at timestamptz not null default now());
create table if not exists public.households (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table if not exists public.household_members (household_id uuid not null references public.households(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, role text not null default 'owner' check (role = 'owner'), joined_at timestamptz not null default now(), primary key (household_id, user_id), unique (user_id));
create table if not exists public.day_entries (household_id uuid not null references public.households(id) on delete cascade, day date not null, payload jsonb not null default '{}'::jsonb, updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), primary key (household_id, day), check (jsonb_typeof(payload) = 'object'));

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.day_entries enable row level security;

create or replace function public.is_household_member(target_household uuid) returns boolean language sql stable security definer set search_path = public, auth set row_security = off as $$ select exists (select 1 from public.household_members m where m.household_id = target_household and m.user_id = auth.uid()); $$;

drop policy if exists "account can view own profile" on public.profiles;
create policy "account can view own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members can view their household" on public.households;
create policy "members can view their household" on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists "account can view own membership" on public.household_members;
create policy "account can view own membership" on public.household_members for select to authenticated using (user_id = auth.uid());

drop policy if exists "account can view day entries" on public.day_entries;
create policy "account can view day entries" on public.day_entries for select to authenticated using (public.is_household_member(household_id));
drop policy if exists "account can add day entries" on public.day_entries;
create policy "account can add day entries" on public.day_entries for insert to authenticated with check (public.is_household_member(household_id) and updated_by = auth.uid());
drop policy if exists "account can update day entries" on public.day_entries;
create policy "account can update day entries" on public.day_entries for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id) and updated_by = auth.uid());
drop policy if exists "account can delete day entries" on public.day_entries;
create policy "account can delete day entries" on public.day_entries for delete to authenticated using (public.is_household_member(household_id));

create or replace function public.create_household(household_name text) returns uuid language plpgsql security definer set search_path = public, auth set row_security = off as $$ declare new_household uuid; begin if auth.uid() is null then raise exception '请先登录'; end if; if length(trim(household_name)) < 1 then raise exception '请输入家庭空间名称'; end if; insert into public.households(name) values (trim(household_name)) returning id into new_household; insert into public.household_members(household_id, user_id, role) values (new_household, auth.uid(), 'owner'); return new_household; end; $$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.households, public.household_members to authenticated;
grant select, insert, update, delete on public.day_entries to authenticated;

do $$ begin alter publication supabase_realtime add table public.day_entries; exception when duplicate_object then null; end $$;
