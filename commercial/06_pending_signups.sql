-- ============================================================================
--  ערבית מצילה חיים — רשימת "ממתינים לאישור" בניהול
--  להריץ פעם אחת ב-Supabase → SQL Editor → New query → להדביק הכול → Run.
--
--  מה זה עושה:
--   • מוסיף פונקציה אחת: pending_signups(). היא מחזירה את מי שנרשם לערכה
--     ועוד לא ברשימת החברים (members): מייל, תאריך הרשמה, כניסה אחרונה.
--   • רק המנהלת מקבלת תשובה. כל משתמש אחר מקבל 0 שורות, ובלי התחברות אין גישה בכלל.
--   • לא משנה שום טבלה, תוכן או הרשאה קיימת.
--
--  בטיחות: הכול בטרנזקציה אחת, עם בדיקה עצמית בסוף. אם משהו לא תקין מופיעה
--  שגיאה בעברית, ושום דבר לא נשמר.
--  ביטול: drop function public.pending_signups();
-- ============================================================================
begin;

-- 0) עצירה בטוחה: הנעילה (04_protect_db.sql) חייבת לרוץ קודם
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'עצירה: חסרה הפונקציה is_admin(). קודם מריצים את 04_protect_db.sql. לא שונה דבר.';
  end if;
end $$;

-- 1) הפונקציה
create or replace function public.pending_signups()
  returns table (email text, created_at timestamptz, last_sign_in_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select u.email::text, u.created_at, u.last_sign_in_at
  from auth.users u
  where public.is_admin()
    and u.email is not null
    and not exists (select 1 from public.members m where lower(m.email) = lower(u.email))
  order by u.created_at desc
  limit 500;
$$;
revoke all on function public.pending_signups() from public;
revoke all on function public.pending_signups() from anon;
grant execute on function public.pending_signups() to authenticated;

-- 2) בדיקה עצמית לפני שמירה
create or replace function pg_temp.as_user(r text, mail text) returns void language plpgsql as $$
begin
  perform set_config('role', r, true);
  perform set_config('request.jwt.claims', json_build_object('role', r, 'email', mail)::text, true);
end $$;
create or replace function pg_temp.count_as(r text, mail text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.as_user(r, mail);
  select count(*) into n from public.pending_signups();
  perform set_config('role', 'none', true);
  return n;
exception when insufficient_privilege then
  perform set_config('role', 'none', true);
  return -1;                                   -- חסום לגמרי = תקין
end $$;

do $$
declare expected bigint; n bigint; adm text;
begin
  select a.email into adm from public.admins a limit 1;
  select count(*) into expected from auth.users u
    where u.email is not null
      and not exists (select 1 from public.members m where lower(m.email) = lower(u.email));
  if expected > 500 then expected := 500; end if;

  n := pg_temp.count_as('anon', '');
  if n > 0 then raise exception 'בדיקה נכשלה: גישה בלי התחברות רואה את רשימת הנרשמים. לא נשמר דבר.'; end if;

  n := pg_temp.count_as('authenticated', 'not-approved-test@example.com');
  if n <> 0 then raise exception 'בדיקה נכשלה: משתמש רגיל רואה את רשימת הנרשמים. לא נשמר דבר.'; end if;

  n := pg_temp.count_as('authenticated', adm);
  if n <> expected then raise exception 'בדיקה נכשלה: המנהלת רואה % ממתינים, וצריך %. לא נשמר דבר.', n, expected; end if;

  raise notice '✓ הבדיקה עברה: בלי התחברות = חסום · משתמש רגיל = 0 · מנהלת = % ממתינים לאישור', expected;
end $$;

commit;
