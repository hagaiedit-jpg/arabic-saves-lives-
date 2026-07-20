-- ============================================================================
--  שכבה מסחרית — שלב 1: פרופילים ומנויים
--  Commercial layer — step 1: profiles + subscriptions
--
--  מריצים ב-Supabase SQL Editor. פעולה חד-פעמית, לא נוגעת בתוכן הקיים.
--  (Supabase Auth already provides auth.users; here we add profile + subscription state.)
-- ============================================================================

-- פרופיל למשתמש (מקושר ל-auth.users של Supabase)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  phone       text,
  display_name text,
  created_at  timestamptz not null default now()
);

-- מצב המנוי של המשתמש. מתעדכן אך ורק ע"י פונקציית ה-webhook (service role).
create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  status                  text not null default 'inactive',   -- active | trialing | past_due | canceled | inactive
  provider                text,                                -- 'stripe' / 'paddle' / ...
  provider_customer_id    text,
  provider_subscription_id text,
  current_period_end      timestamptz,                         -- עד מתי המנוי בתוקף
  updated_at              timestamptz not null default now()
);

-- ============================================================================
--  פונקציית העזר המרכזית: האם המשתמש הנוכחי מנוי פעיל *כרגע*?
--  זו הפונקציה שכל מדיניות RLS על התוכן תשתמש בה.
-- ============================================================================
create or replace function public.is_subscribed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = auth.uid()
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- ============================================================================
--  RLS על טבלאות המנוי עצמן: כל אחד רואה רק את השורה שלו.
--  כתיבה נעשית רק ע"י service role (פונקציית ה-webhook) — לכן אין policy לכתיבה.
-- ============================================================================
alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "own profile"      on public.profiles;
drop policy if exists "own subscription" on public.subscriptions;

create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);
