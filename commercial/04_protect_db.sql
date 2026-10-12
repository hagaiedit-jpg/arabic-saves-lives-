-- ============================================================================
--  ערבית מצילה חיים — נעילת המאגר (RLS) לפיילוט ולמכירה
--  להריץ פעם אחת ב-Supabase → SQL Editor → New query → להדביק הכול → Run.
--
--  מה זה עושה:
--   • משפטים (phrases): רק משתמש מחובר שנמצא ברשימת members (או מנהלת) רואה תוכן.
--     גישה בלי התחברות, או של מי שנרשם ולא אושר = אפס שורות. עריכה = מנהלת בלבד.
--   • רשימת החברים (members): כל משתמש רואה רק את השורה של עצמו.
--
--  בטיחות:
--   • הכול בתוך טרנזקציה אחת. בסוף יש בדיקה עצמית (סעיף 6). אם משהו לא עובד
--     כמצופה — מופיעה שגיאה בעברית, ושום דבר לא נשמר. המאגר נשאר כמו שהיה.
--   • אם המייל של המנהלת לא קיים במשתמשים — עוצר מיד, בלי לשנות דבר
--     (כדי שלא תינעלי מחוץ לניהול).
--   • ביטול חירום: commercial/05_unprotect_db.sql (שורה אחת, מחזיר את המצב הקודם).
--
--  ⚠️ אם את נכנסת לניהול עם מייל אחר — להחליף אותו בשורה הבאה (רק שם).
-- ============================================================================
begin;

select set_config('app.admin_email', lower('hagaiedit@gmail.com'), true);

-- 0) עצירה בטוחה: המנהלת חייבת להיות משתמשת קיימת
do $$
begin
  if not exists (select 1 from auth.users where lower(email) = current_setting('app.admin_email')) then
    raise exception 'עצירה: המייל % לא נמצא ב-Authentication → Users. לא שונה דבר.', current_setting('app.admin_email');
  end if;
end $$;

-- 1) רשימת מנהלות (לא נגישה דרך האפליקציה בכלל)
create table if not exists public.admins (email text primary key);
insert into public.admins(email) values (current_setting('app.admin_email')) on conflict do nothing;
alter table public.admins enable row level security;

-- 2) פונקציות עזר: מי מנהלת, מי חברה
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                 where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin(), public.is_member() from public;
grant execute on function public.is_admin(), public.is_member() to anon, authenticated;

-- 3) המנהלת גם ברשימת החברים (כדי שהאפליקציה תפתח לה)
insert into public.members(email)
  select current_setting('app.admin_email')
  where not exists (select 1 from public.members where lower(email) = current_setting('app.admin_email'));

-- 4) משפטים: מוחקים כל מדיניות ישנה (גם "פתוח לכולם"), ומגדירים חדשה
alter table public.phrases enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'phrases' loop
    execute format('drop policy %I on public.phrases', p.policyname);
  end loop;
end $$;
create policy "members and admin read" on public.phrases
  for select to authenticated using (public.is_member() or public.is_admin());
create policy "admin insert" on public.phrases
  for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.phrases
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.phrases
  for delete to authenticated using (public.is_admin());

-- 5) רשימת החברים: כל אחד רואה רק את עצמו; המנהלת מנהלת
alter table public.members enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'members' loop
    execute format('drop policy %I on public.members', p.policyname);
  end loop;
end $$;
create policy "own row" on public.members
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_admin());
create policy "admin manage" on public.members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6) בדיקה עצמית לפני שמירה. כל כישלון = שגיאה + שום דבר לא נשמר.
create or replace function pg_temp.visible(tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', tbl) into n; return n;
exception when insufficient_privilege then return 0;   -- חסום לגמרי = גם תקין
end $$;
create or replace function pg_temp.as_user(r text, mail text) returns void language plpgsql as $$
begin
  perform set_config('role', r, true);
  perform set_config('request.jwt.claims',
    json_build_object('role', r, 'email', mail)::text, true);
end $$;

do $$
declare total bigint; n bigint; anyid text;
begin
  select count(*) into total from public.phrases;

  -- א. בלי התחברות (כמו מי שמנסה לשלוף ישירות): אפס
  perform pg_temp.as_user('anon', '');
  if pg_temp.visible('phrases') > 0 then raise exception 'בדיקה נכשלה: גישה בלי התחברות עדיין רואה משפטים. לא נשמר דבר.'; end if;
  if pg_temp.visible('members') > 0 then raise exception 'בדיקה נכשלה: גישה בלי התחברות רואה את רשימת החברים. לא נשמר דבר.'; end if;
  perform set_config('role', 'none', true);

  -- ב. נרשם שלא אושר: אפס
  perform pg_temp.as_user('authenticated', 'not-approved-test@example.com');
  if pg_temp.visible('phrases') > 0 then raise exception 'בדיקה נכשלה: משתמש שלא אושר רואה משפטים. לא נשמר דבר.'; end if;
  perform set_config('role', 'none', true);

  -- ג. המנהלת: רואה הכול ויכולה לערוך
  perform pg_temp.as_user('authenticated', current_setting('app.admin_email'));
  n := pg_temp.visible('phrases');
  if n <> total then raise exception 'בדיקה נכשלה: המנהלת רואה % מתוך % משפטים. לא נשמר דבר.', n, total; end if;
  if total > 0 then
    select id::text into anyid from public.phrases limit 1;
    update public.phrases set he = he where id::text = anyid;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'בדיקה נכשלה: המנהלת לא יכולה לערוך. לא נשמר דבר.'; end if;
  end if;
  perform set_config('role', 'none', true);

  raise notice '✓ הבדיקה עברה: בלי התחברות = 0 משפטים · לא מאושר = 0 · מנהלת = % משפטים ועריכה תקינה', total;
end $$;

commit;
