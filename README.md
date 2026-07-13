# ערבית מצילה חיים — Arabic Saves Lives

PWA ללימוד ערבית מדוברת לתקשורת בשטח ולמניעת הסלמה. עובד גם ללא אינטרנט.

**אתר חי:** https://arabicsaveslives.hagaiedit.workers.dev

---

## ארכיטקטורה (מבט־על למתכנת/ת)

| רכיב | טכנולוגיה | הערות |
|------|-----------|-------|
| Frontend | קובץ יחיד `index.html` (~950KB, וניל JS) | אין build system. ראו "חוב טכני". |
| Service worker | `sw.js` | offline-first. יש להעלות `CACHE` בכל שינוי מהותי. |
| Manifest | `manifest.json` + `icon*.png/svg` | הגדרות PWA + אייקונים. |
| מסד נתונים | Supabase (טבלת `phrases`) | נגיש עם מפתח פרסום (publishable) בצד לקוח. |
| מדיה (הקלטות) | Cloudinary | preset `arabic_audio`. |
| אירוח/פריסה | Cloudflare Workers (assets) | `wrangler.jsonc`. פריסה אוטומטית מ־`main`. |
| ניתוח שימוש | Google Analytics (`G-G91ERLFQ16`) | **טעון רק לאחר הסכמה** — ראו `loadAnalytics()`. |

## מבנה הנתונים

טבלת `phrases` מחולקת לפי `section`: `military` (מבצעי), `daily`, `heart` (פותחים לב),
`navy`, `announce`, `dictionary`, `semantic`, `customs`, `scenario`, `article`.
שדות עיקריים: `he`, `trans`, `ar`, `why`, `tone`, `cat`, `audio_url`, `tags`, `section`, `is_new`.

## פריסה

הדחיפה ל־`main` מפעילה בנייה אוטומטית של Cloudflare. **אין סביבת staging** — ראו מסמך המתכנת.
לפריסה ידנית: `wrangler deploy` (דורש הרשאות Cloudflare).

## מוסכמות פיתוח

- כל שינוי ב־`index.html` → **להעלות את `CACHE` ב־`sw.js`** (למשל `asl-v44` → `asl-v45`) כדי שהעדכון יגיע למכשירים.
- אין תעתיק? השאירו ריק — ניתן להשלים דרך ממשק הניהול.
- ממשק הניהול (טאב "ניהול") נחשף רק לאחר התחברות (Supabase Auth).

## חוב טכני ידוע / צעדים הבאים

ראו את המסמך **"מפת דרכים לגרסה מסחרית"** (נמסר בנפרד). בקצרה, לפני הוצאה מסחרית:
1. אימות מדיניות הרשאות (RLS) ב־Supabase.
2. העלאות חתומות ל־Cloudinary.
3. סביבת staging + CI/CD + גיבויים אוטומטיים.
4. פירוק המונוליט ל־build מודולרי.

## רישיון ובעלות

כל הזכויות שמורות. ראו `תנאי שימוש` בתוך האפליקציה (תפריט ⚙️).
