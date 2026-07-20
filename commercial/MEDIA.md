# הגנת מדיה (אודיו) — תוכנית ויישום

## הבעיה
ה-RLS (שלב 3) מגן על **שורות ה-DB**, אבל קובצי ההקלטות יושבים ב-Cloudinary
עם **URL ציבורי** — כל מי שיש לו את הקישור יכול להשמיע אותם, גם בלי מנוי.
כלומר: גם אחרי חומת התשלום על הטקסט, האודיו ה-premium עדיין חשוף.

> חשוב לצפייה מציאותית: **אי אפשר להגן ב-100%** על מדיה שכבר נוגנה/ירדה
> למכשיר (אפשר להקליט את הפלט). המטרה היא הגנה **סבירה ומקצועית**: לחסום גישה
> ישירה לקישורים, ולהצמיד גישה למנוי פעיל עם קישורים קצרי-מועד.

## שתי גישות
### א. Cloudinary "authenticated delivery" + auth-token קצר-מועד (מומלץ)
- מעלים אודיו **premium** כ-`type: authenticated` (לא ציבורי).
- בשרת (Edge Function) בודקים מנוי פעיל, ומחזירים **auth-token** קצר-מועד
  (למשל שעה) שמאפשר להשמיע רק את הקובץ המבוקש.
- יתרון: התוכן החינמי (טעימה) יכול להישאר ציבורי; משנים רק את ה-premium.
- קובץ: `functions/media-sign/index.ts` (מימוש ייחוס).

### ב. Supabase Storage (באקט פרטי) + signed URL
- מעבירים אודיו premium ל-Storage פרטי; יוצרים signed URL קצר-מועד למנויים.
- נקי ומרוכז ב-Supabase, אבל דורש **הגירת כל קבצי האודיו** מ-Cloudinary.

## סדר יישום מומלץ (לא שובר את האפליקציה החיה)
1. **להשאיר את אודיו הטעימה (free) כמו שהוא** — ציבורי, עובד היום.
2. להעלות מחדש את אודיו ה-premium כ-`type: authenticated` (או להעביר ל-Storage).
   שמרו מיפוי `public_id` לכל הקלטה (יש כבר את ה-URL-ים ב-backup ה-JSON).
3. לפרוס את `media-sign` ולהגדיר את סודות Cloudinary (מפתח auth-token).
4. **אינטגרציה בקליינט:** במקום להשמיע `audio_url` ישירות עבור premium, לקרוא
   ל-`clSignedAudio(publicId)` שמחזיר URL חתום קצר-מועד. סקיצה:

```js
// דורש התחברות (clSession) — מחזיר URL חתום, או null אם אין מנוי.
async function clSignedAudio(publicId){
  var s = clSession(); if(!s) return null;
  try{
    var r = await fetch(SUPA_URL + '/functions/v1/media-sign', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+s.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ public_id: publicId })
    });
    if(!r.ok) return null;
    var d = await r.json();
    return d.url || null;
  }catch(e){ return null; }
}
// נקודת אינטגרציה: היכן שהאפליקציה מנגנת אודיו premium — להשתמש בתוצאה של
// clSignedAudio() במקום ב-audio_url הגולמי. אודיו free ממשיך כרגיל.
```

## אכיפת Offline למדיה
- למנוי פעיל: מותר לשמור אודיו premium במטמון (כמו "חבילת אופליין" היום), אך
  לצרף **תוקף** — כשהמנוי פוקע/מבוטל, לנקות את המטמון (ראו README, פרק Offline).
- ה-auth-token קצר-המועד ממילא מונע שיתוף קישורים לאורך זמן.

## מה נכתב כאן ומה נשאר
- ✅ נכתב: תוכנית, `media-sign` (Edge Function ייחוס), וסקיצת אינטגרציה בקליינט.
- ⛔ נשאר (דורש חשבון/פריסה/בדיקה): הגדרת Cloudinary authenticated + מפתח
  auth-token, העלאה/הגירה מחדש של אודיו premium, פריסת הפונקציה, וחיווט נגן
  האודיו בקליינט. דורש גישה לחשבון Cloudinary — לא זמין ל-Claude.
