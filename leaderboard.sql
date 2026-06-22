-- Unit leaderboard table for "ערבית מצילה חיים"
-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard → SQL Editor).
-- The app reads/writes this table with the public (anon) key, so RLS policies are open.
-- Note: no personal login — rows are keyed by a random per-device client_id, and grouped
-- by a shared free-text unit_code. Users are told not to enter identifying details.

create table if not exists public.leaderboard (
  client_id   text primary key,
  unit_code   text not null,
  nickname    text not null,
  score       integer not null default 0,
  streak      integer not null default 0,
  week        text not null,
  updated_at  timestamptz not null default now()
);

-- Fast lookup of a unit's board for a given week
create index if not exists leaderboard_unit_week_idx
  on public.leaderboard (unit_code, week, score desc);

alter table public.leaderboard enable row level security;

-- Anyone with the anon key may read and upsert their own row.
drop policy if exists "leaderboard read"   on public.leaderboard;
drop policy if exists "leaderboard insert" on public.leaderboard;
drop policy if exists "leaderboard update" on public.leaderboard;

create policy "leaderboard read"   on public.leaderboard for select using (true);
create policy "leaderboard insert" on public.leaderboard for insert with check (true);
create policy "leaderboard update" on public.leaderboard for update using (true) with check (true);
