# הפעלת "גישה בתשלום" — פיילוט (הפעלה ידנית) — צעד אחר צעד

> המודל: התוכן נפתח רק למי ש**התחבר** (אימייל + קוד) **וגם שילם**. בפיילוט התשלום
> נגבה **ידנית** (ביט/PayBox/העברה), ואת מפעילה כל חשבון ידנית ע"י הוספת המייל
> לרשימת "שילמו". בהמשך נעבור לתשלום אוטומטי (Stripe). הקוד באפליקציה כבר בנוי.

## איך זה עובד לחייל
פותח קישור → «התחברות לערכה» → מזין אימייל → מקבל קוד במייל → מתחבר →
רואה מסך «החשבון עדיין לא הופעל» עם הנחיה לתשלום → משלם לך → את מוסיפה אותו
לרשימה → הוא לוחץ «כבר שילמתי — בדוק שוב» → נכנס.

## המצב כרגע
- ✅ מסך התחברות + מסך «ממתין להפעלה» בנויים.
- ✅ קריאות התוכן נושאות את הטוקן של המשתמש (מוכן ל-RLS).
- ✅ הנעילה **כבויה** (`window.LOGIN_GATE`), כדי שאף אחד לא ייחסם עד שנסיים.
- ⏳ נשאר: הקמה ב-Supabase, ואז מדליקים.

---

## צעד 1 — להדליק התחברות באימייל (Supabase Auth)
Authentication → Providers → **Email**: לוודא שמופעל, ולהדליק **Email OTP** (קוד).

## צעד 2 — טבלת "שילמו" + להוסיף את עצמך
```sql
create table if not exists public.members (
  email text primary key,
  paid_at timestamptz default now(),
  note text
);
-- כדי שהאפליקציה תוכל לבדוק "האם אני הופעלתי" — משתמש רואה רק את השורה של עצמו:
alter table public.members enable row level security;
create policy "read own membership" on public.members
  for select using (lower(auth.jwt() ->> 'email') = lower(email));

-- להוסיף את עצמך (ומנהלים), שלא תיחסמי:
insert into public.members (email, note) values ('hagaiedit@gmail.com', 'admin');
```
**להפעיל חייל ששילם** = שורה אחת:
```sql
insert into public.members (email, note) values ('soldier@example.com', 'שילם בביט 20/9');
```
**לבטל גישה** = למחוק את השורה.

## צעד 3 — לנעול את טבלת התוכן (RLS) — הלב של ההגנה
```sql
alter table public.phrases enable row level security;
create policy "paid members read" on public.phrases
  for select using (
    lower(auth.jwt() ->> 'email') in (select lower(email) from public.members)
  );
```
> ⚠️ ודאי שהוספת את עצמך ל-members לפני שמריצים את זה.
> אם יש עוד טבלאות תוכן/מדיה — נחיל עליהן את אותו היגיון.

## צעד 4 — להדליק את הנעילה באפליקציה
- **לבדיקה במכשיר שלך:** קונסולה → `localStorage.setItem('login_gate','1')` → רענון.
- **להשקה לכולם:** אני משנה את ברירת המחדל בקוד ל-ON ודוחפת גרסה.

---

## תזרים התשלום בפיילוט (ידני)
1. חייל נרשם (אימייל+קוד) ומגיע ל«ממתין להפעלה».
2. משלם לך (ביט/PayBox/העברה) — סוגרים בוואטסאפ, ומוסר לך את המייל שאיתו נרשם.
3. את מריצה `insert ... into members` עם המייל שלו.
4. הוא לוחץ «כבר שילמתי — בדוק שוב» → נכנס. גישה לכל החיים.

## שדרוג עתידי — תשלום אוטומטי (Stripe)
כשיהיה נפח: פותחים Stripe, מחברים דף תשלום + webhook שמוסיף אוטומטית ל-members.
אז לא צריך להפעיל ידנית. שאר המנגנון (התחברות, RLS, מסכים) נשאר זהה.
