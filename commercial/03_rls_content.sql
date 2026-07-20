-- ============================================================================
--  שכבה מסחרית — שלב 3: הפעלת חומת התשלום בצד השרת (RLS על התוכן)
--  Commercial layer — step 3: enable the server-side paywall (RLS on content)
--
--  ⚠️  להריץ *רק אחרי* שהתחברות משתמשים + מנויים + התחברות בקליינט קיימים.
--      ברגע שזה רץ: משתמש אנונימי (כמו האפליקציה של היום) יראה רק תוכן 'free'.
--      אם תריצי את זה לפני שיש התחברות — כל התוכן בתשלום ייעלם לכולם.
--      לכן: קודם שלב 4–5 (Auth + סליקה), ורק אז השלב הזה.
-- ============================================================================

alter table public.phrases enable row level security;

-- קריאה: תוכן חינמי גלוי לכולם (גם אנונימי).
drop policy if exists "read free content" on public.phrases;
create policy "read free content" on public.phrases
  for select using (tier = 'free');

-- קריאה: מנוי פעיל רואה הכול.
drop policy if exists "read premium if subscribed" on public.phrases;
create policy "read premium if subscribed" on public.phrases
  for select using (public.is_subscribed());

-- ----------------------------------------------------------------------------
--  כתיבה (עריכה/ניהול תוכן): נשארת מוגבלת לעורך/מנהל בלבד.
--  התאימי ל-uid של חשבון המנהל שלך (מ-auth.users). זה מחליף את ההסתמכות
--  הנוכחית על טוקן-מנהל בצד לקוח.
-- ----------------------------------------------------------------------------
drop policy if exists "admin writes" on public.phrases;
create policy "admin writes" on public.phrases
  for all
  using      ( auth.uid() = 'PUT-ADMIN-USER-UUID-HERE'::uuid )
  with check ( auth.uid() = 'PUT-ADMIN-USER-UUID-HERE'::uuid );

-- הערה על מדיה (אודיו): RLS מגן על שורות ה-DB בלבד. קובצי ההקלטות ב-Cloudinary
-- הם URL ציבורי ואינם מוגנים ע"י RLS. הגנה על אודיו בתשלום = משימה נפרדת:
--   אפשרות א: להעביר אודיו בתשלום ל-Supabase Storage (באקט פרטי) + signed URLs.
--   אפשרות ב: Cloudinary "authenticated delivery" + signed URL קצר-מועד שנוצר
--             בפונקציית edge רק למנויים.
-- ראי README.md, פרק "הגנת מדיה".
