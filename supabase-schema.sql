-- ============================================================
--  UniBudget — Supabase schema
--  Run this once in your project:  Supabase dashboard → SQL Editor → paste → Run
-- ============================================================

-- One row per user holding their whole budget state as JSON.
create table if not exists public.budgets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: each user may only see and edit their own row.
alter table public.budgets enable row level security;

drop policy if exists "own budget - select" on public.budgets;
create policy "own budget - select" on public.budgets
  for select using (auth.uid() = user_id);

drop policy if exists "own budget - insert" on public.budgets;
create policy "own budget - insert" on public.budgets
  for insert with check (auth.uid() = user_id);

drop policy if exists "own budget - update" on public.budgets;
create policy "own budget - update" on public.budgets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
