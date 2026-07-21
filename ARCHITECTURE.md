# ARCHITECTURE — מפת המערכת למפתח/ת

מסמך עומק שממפה את הקוד כפי שהוא היום. משלים את `README.md` (מבט-על) ואת
`commercial/README.md` (השכבה המסחרית הרדומה). נכתב אחרי מיפוי מלא של הקוד
ובדיקות ריצה — יולי 2026.

> **הכלל החשוב ביותר:** האפליקציה כולה חיה ב-`index.html` אחד (~18,500 שורות,
> ~1.1MB, וניל JS, בלי build). כל שינוי מחייב: (1) בדיקת syntax לכל בלוקי
> ה-script, (2) העלאת `CACHE` ב-`sw.js`, (3) בדיקת עשן (ראו `tests/`).

---

## 1. קבצים בריפו

| נתיב | מהות |
|---|---|
| `index.html` | כל האפליקציה: UI, לוגיקה, תוכן מובנה, אדמין, PWA glue |
| `sw.js` | Service worker. שני caches: `asl-vNN` (מתחלף בכל דיפלוי) + `asl-media-v1` (הקלטות/פונטים — שורד עדכונים) |
| `manifest.json`, `icon*` | PWA |
| `commercial/` | השכבה המסחרית (SQL + Edge Functions + תיעוד) — **לא פרוסה, לא רצה** |
| `tests/` | בדיקות עשן (Playwright) — ראו `tests/README.md` |
| `marketing/` | דפי נחיתה/שאלונים סטטיים |
| `leaderboard.sql` | טבלת לידרבורד (Supabase) |
| `wrangler.jsonc` | פריסה: Cloudflare Workers assets; דחיפה ל-`main` = דיפלוי אוטומטי. **אין staging** |

## 2. Backends חיצוניים

| שירות | תפקיד | אימות |
|---|---|---|
| Supabase (`ukynfcwxsrzpuqecfjuz`) | טבלת `phrases` (כל התוכן, ~1,700 שורות), Auth של האדמין | קריאה: מפתח publishable (אנונימי) — **כל התוכן קריא לכל אחד**. כתיבה: טוקן אדמין בלבד (`_sbAuthHeader`) |
| Cloudinary | קבצי ההקלטות (URL ציבורי) | העלאה: unsigned preset `arabic_audio` |
| Google Fonts + GA | פונטים; אנליטיקס בהסכמה בלבד (`loadAnalytics`) | מנוטרל לגמרי ב-SECURE_MODE |

## 3. זרימת הנתונים (הלב של המערכת)

```
loadData()  ← נקרא באתחול וגם אחרי כל שמירת אדמין
  │  sbFetchAllRows('/rest/v1/phrases?...')   ← עימוד 1000 שורות
  │  data.filter(section === X).map(mp)       ← mp() ממפה שורת DB לאובייקט UI
  ▼
מערכי section גלובליים (let, לא על window):
  DB(military) DAILY HRT(heart) NAVY ANNOUNCE DICT(dictionary)
  SEM(semantic) CUS(customs) ARTS(article) INTEL(intel_field) SCENARIO
  │
  ├─ מיזוג תוכן מובנה (בקוד, עובד גם עם backend ריק):
  │    BUILTIN_DICT (~430, מילון מבצעי 19 נושאים) → DICT   (דדופ לפי he)
  │    BUILTIN_SCENARIO_DATA (193) → SCENARIO             (דדופ לפי cat+step)
  │    BUILTIN_CUSTOMS (9) → CUS                          (דדופ לפי he)
  │    BUILTIN_TASHAUL (103), CARANN_SCENARIO, SURVEY_PACK ← דרך כלים/סנכרון
  ▼
renderAllData() → כל פונקציות ה-render (bldCats, rDG, renderDict, renderScnGrid…)
```

נקודות חשובות:
- `mp()` ממיר `audio_url` → `audio` דרך `_cldAudio()` (מוסיף `/f_mp3/` כדי
  ש-iOS ינגן webm שהוקלט באנדרואיד).
- **`autoSyncBuiltins()`** (רץ בכניסת אדמין): דוחף כל תוכן מובנה שחסר ב-DB
  ל-Supabase תחת הטוקן של האדמין — כך תוכן שנוסף בקוד הופך לעריך/מוקלט.
  Guard: `window._builtinsSynced`.
- החיפוש הגלובלי (`_gsSections`) והמילון החכם (`buildSmartDictIndex` →
  `SMART_DICT_INDEX`) אינדקסים **את כל** המקורות; המילון ממפה מילה→משפטים
  ומעדיף משפטים עם הקלטה (`hasAudio`, מיון audio-first).

## 4. תתי-מערכות עיקריות (לפי שמות פונקציות)

| תת-מערכת | פונקציות מפתח |
|---|---|
| אדמין (עריכת תוכן) | `promptAdminLogin`, `adminLogin`, `_sbAuthHeader`, `renderAdminList`, `openEditById`, `saveEdit(advance)` |
| תור עריכה/הקלטה רציף | `window._auditNav` + `window._navMode` ('audit'/'rec'), `_rebuildRecNav`, `startRecQueue`, "שמור והמשך" ב-`saveEdit(true)` |
| רשימת מילים ללא הקלטה | `renderRecordWorklist` (מילה "מכוסה" אם יש לה הקלטה או משפט מוקלט שמכיל אותה) |
| הקלטה והעלאה | `createRecorder`, `_recFile`, `toggleRec`, `getAudio`, `cloudUp` (Cloudinary) |
| גיבוי | `downloadBackup` (JSON כל התוכן), `downloadAudioBackup` (ZIP הקלטות + index.csv; `_makeZip`/`_crc32` — ZIP writer עצמאי), `_refreshBackupState` (צ'יפים+נודג' 30 יום) |
| אופליין | sw.js (cache-first) + `downloadAllOffline` (חבילת הקלטות, נעול בקוד גישה SHA-256 — הגנת צד-לקוח בלבד) |
| תרחישים/למידה/משחקים | `renderScnGrid`, `opDC`, `startDailyLearn`, flashcards, streaks — עצמאיים יחסית |

## 5. דגלים רדומים (dormant flags) — ברירת מחדל: כבוי

| דגל | הפעלה | מה עושה |
|---|---|---|
| `SECURE_MODE` | `?secure=1` / `localStorage.secureMode='1'` / מתג 🛡️ בתפריט ⚙️ | אפס קריאות צד-ג': בלי Google Fonts ובלי GA (גם עם הסכמה) |
| `COMMERCE_LOGIN` | `?login=1` / `localStorage.commerceLogin='1'` | מסך התחברות טלפון+OTP (`clSendCode`/`clVerify`), סשן (`cl_at`/`cl_user`), זכאות אופליין: `clHasAccess` (חסד 14 יום), `clRefreshEntitlement` (רענון כל 3 ימים; שגיאת רשת שומרת חסד; "אין מנוי" ודאי → `clClearPremiumCache`) |

השכבה המסחרית המלאה (מנויים/RLS/סליקה/מדיה חתומה) — ב-`commercial/`,
עם סדר פריסה בטוח ב-`commercial/README.md`. **אסור** להריץ את
`03_rls_content.sql` לפני שיש Auth+סליקה — אחרת תוכן premium ייעלם לכולם.

## 6. יומן שגיאות (client)

`window.onerror` + `unhandledrejection` נלכדים ל-ring buffer ב-localStorage
(`err_log`, עד 50). צפייה/הורדה/ניקוי: אזור הניהול → "🚨 יומן שגיאות"
(`renderErrLog`, `downloadErrLog`, `clearErrLog`).

## 7. מוסכמות עבודה (חובה)

1. **תוכן מובנה** מתווסף למערכי `BUILTIN_*` (ולא ישירות ל-DB) — נטען מהקוד,
   עובד אופליין, ומסונכרן ל-DB אוטומטית תחת אדמין.
2. אחרי כל שינוי: `node -e` syntax-check על כל בלוקי ה-script (ראו
   `tests/README.md`), הרצת `tests/smoke.js`, והעלאת `CACHE` ב-`sw.js`.
3. טקסט משתמש בעברית; ערבית בכתב + תעתיק עברי מנוקד (שדّה → דגש; אין
   גרש בודד `'` בתוך מחרוזות JS — משתמשים ב-geresh `׳`).
4. אין להוסיף תלות חיצונית (CDN) — שובר את מצב האופליין ואת SECURE_MODE.

## 8. חוב טכני ידוע (בסדר סיכון)

1. **קובץ יחיד ענק** — מודולריזציה נדרשת אך מסוכנת; לבצע רק עם רשת בדיקות
   (tests/) ובשלבים.
2. **אין הפרדת סביבות** — כל דחיפה ל-main היא production.
3. **כל התוכן ציבורי** — עד פריסת השכבה המסחרית (RLS).
4. **סנכרון תוכן מלא בכל טעינה** — `cached_phrases` ב-localStorage מרכך,
   אך אין delta-sync.
5. הגנת "חבילת אופליין" היא צד-לקוח בלבד (קוד גישה hash) — ידוע ומתועד.
