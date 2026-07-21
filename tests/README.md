# tests — בדיקות עשן לפני כל דיפלוי

## הרצה
```bash
npm i -D playwright          # פעם אחת (או התקנה גלובלית)
node tests/smoke.js          # כ-20 שניות
```
דפדפן מותאם: `SMOKE_CHROME=/path/to/chrome node tests/smoke.js`

## מה נבדק
1. **טעינה + תוכן מובנה** (עם backend מדומה ריק): אפס שגיאות JS; מילון ≥400
   מילים ו-≥19 נושאים; תרחישים ≥190; אינדקס המילון החכם והחיפוש; קיום פונקציות
   הליבה; תקינות כותב ה-ZIP.
2. **מצב מאובטח**: `?secure=1` ⇒ אפס קריאות לגוגל; ברירת מחדל ⇒ הדגל כבוי.
3. **שכבת המסחר הרדומה**: כבוי ⇒ מסך התחברות מוסתר; `?login=1` ⇒ זרימת
   טלפון→קוד→סשן מלאה (OTP מדומה), ולוגיקת הזכאות (חסד/פקיעה/רענון).
4. **יומן שגיאות**: לכידה ל-`err_log` והצגה ב-`renderErrLog`.

הכול רץ נגד `index.html` מהדיסק עם רשת מדומה — אפס תלות בשרתים אמיתיים,
מהיר ודטרמיניסטי.

## בדיקת syntax מהירה (בנוסף)
```bash
node -e "
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync('index.html','utf8');
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m,i=0,bad=0;
while((m=re.exec(html))){ i++; try{ new vm.Script(m[1]); }catch(e){ bad++; console.log('S#'+i+': '+e.message);} }
console.log('checked '+i+' scripts, '+bad+' errors');
"
```

## נוהל שחרור מומלץ
1. שינוי קוד → בדיקת syntax → `node tests/smoke.js` (הכול ירוק).
2. העלאת `CACHE` ב-`sw.js` (אחרת משתמשים יקבלו גרסה ישנה מהמטמון).
3. דחיפה ל-`main` (= דיפלוי אוטומטי ב-Cloudflare; אין staging).
