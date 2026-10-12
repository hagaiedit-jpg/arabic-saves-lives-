-- ביטול חירום של הנעילה: מחזיר את הקריאה הפתוחה של המשפטים (כמו לפני הנעילה),
-- אבל העריכה נשארת למנהלת בלבד. להריץ ב-Supabase → SQL Editor רק אם אחרי
-- 04_protect_db.sql משתמשים לגיטימיים לא רואים תוכן.
-- כדי לנעול שוב: להריץ שוב את 04_protect_db.sql (הוא מוחק את המדיניות הזמנית).
create policy "temporary open read" on public.phrases
  for select to anon, authenticated using (true);
