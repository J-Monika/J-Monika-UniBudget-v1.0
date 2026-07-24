-- ============================================================
--  UniBudget — Supabase schema
--  Run this once in your project:  Supabase dashboard → SQL Editor → paste → Run
--  Safe to re-run (idempotent).
-- ============================================================

-- Settings blob per user (currency + category limits).
create table if not exists public.budgets (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Per-row transactions for real offline-first sync (LWW + tombstones).
--  id: 'gcash-<ref>' for GCash captures (deterministic → cross-device de-dup)
--      or 'm-<random>' for manual entries.
create table if not exists public.transactions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  id          text not null,
  amount      numeric(14,2) not null,
  type        text not null check (type in ('income','expense')),
  category    text,
  description text,
  occurred_at timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  primary key (user_id, id)
);
create index if not exists transactions_sync_idx
  on public.transactions (user_id, updated_at);

alter table public.transactions enable row level security;

drop policy if exists "own txns - all" on public.transactions;
create policy "own txns - all" on public.transactions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
