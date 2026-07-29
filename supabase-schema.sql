-- ============================================================
--  UniBudget — Supabase schema
--  Run this once in your project:  Supabase dashboard → SQL Editor → paste → Run
--  Safe to re-run (idempotent).
-- ============================================================

-- Settings blob per user (currency + category limits + notification settings).
-- Expected data structure in jsonb:
-- {
--   "currency": "PHP",
--   "limits": { "Food & Dining": 2000, ... },
--   "notifications": {
--     "enabled": true,
--     "thresholds": [
--       { "id": "t-75-total", "category": "Total", "type": "percentage", "value": 75, "is_active": true },
--       { "id": "t-100-total", "category": "Total", "type": "percentage", "value": 100, "is_active": true }
--     ],
--     "triggered_alerts": { "t-75-total": 1720000000000 }
--   }
-- }
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

-- Per-row Peer Ledger (Utang / Pa-Suyo tracker) entries for offline-first sync (LWW + tombstones).
create table if not exists public.peer_ledger (
  user_id           uuid not null references auth.users (id) on delete cascade,
  id                text not null,
  type              text not null check (type in ('UTANG_GIVEN','UTANG_TAKEN','PA_SUYO')),
  counterparty_name text not null,
  amount            numeric(14,2) not null,
  currency          text not null default 'PHP',
  description       text,
  status            text not null default 'UNSETTLED' check (status in ('UNSETTLED','PARTIALLY_SETTLED','SETTLED')),
  settled_amount    numeric(14,2) not null default 0,
  due_date          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted           boolean not null default false,
  primary key (user_id, id)
);
create index if not exists peer_ledger_sync_idx
  on public.peer_ledger (user_id, updated_at);

alter table public.peer_ledger enable row level security;

drop policy if exists "own peer_ledger - all" on public.peer_ledger;
create policy "own peer_ledger - all" on public.peer_ledger
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

