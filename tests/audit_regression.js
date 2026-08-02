#!/usr/bin/env node
/*
 * Audit / recordings / scenarios REGRESSION suite — "ערבית מצילה חיים"
 * Run:  node tests/audit_regression.js
 * Requires Playwright (same as smoke.js). Loads index.html from disk with a
 * per-test STUBBED Supabase, and locks in the behaviors fixed during the big
 * recordings/scenarios cleanup so they can never silently regress:
 *
 *   1  scenarios are never treated as duplicates / never deleted by the shadow fix
 *   2  scenario step keys are separator-insensitive (variant category names match);
 *      soldier vs civilian ("step3" vs "step3 civilian") stay distinct
 *   3  scenario display collapses variant duplicates, keeping the recorded copy
 *   4  merge tool deletes only true same-step duplicates (keeps recording/unique/untagged)
 *   5  shared audio: the exact phrase plays across sections; distinct words never borrow
 *   6  NO fuzzy near-duplicate matching (distinct words like למה/כמה never paired)
 *   7  hard-delete blocklists a built-in so it does NOT come back on reload
 *   8  orphan foundation categories (months/topography) are hidden from the audit
 *   9  a phrase recorded elsewhere (exact) counts as covered, not missing
 *  10  scenario headers (no Arabic) are excluded from the record list
 *  11  dup-check tool pre-marks ONLY empty copies; recordings are protected
 *  12  text ids (spaces/slashes) resolve & save (URL-encoded)
 */
const path = require('path');
const fs = require('fs');

function resolvePlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs', '/usr/lib/node_modules/playwright'];
  for (const c of candidates) { try { return require(c); } catch (e) {} }
  return null;
}

async function main() {
  let pw = resolvePlaywright();
  if (!pw) { try { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); } catch (e) { console.error('Playwright not found. Run: npm i -D playwright'); process.exit(2); } }
  const { chromium } = pw;
  const repo = path.resolve(__dirname, '..');
  const indexUrl = 'file://' + path.join(repo, 'index.html');
  if (!fs.existsSync(path.join(repo, 'index.html'))) { console.error('index.html not found'); process.exit(2); }

  const launchOpts = {};
  if (process.env.SMOKE_CHROME) launchOpts.executablePath = process.env.SMOKE_CHROME;
  else { const guess = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'; if (fs.existsSync(guess)) launchOpts.executablePath = guess; }

  const browser = await chromium.launch(launchOpts);
  let pass = 0, fail = 0; const failures = [];
  function check(name, ok, detail) {
    if (ok) { pass++; console.log('  ✓ ' + name); }
    else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
  }

  // Load index.html with a Supabase stub that serves `rows` for scenario/phrase
  // GETs and records DELETE/POST/PATCH. `capture` collects mutations.
  async function load(rows, capture) {
    const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
    capture = capture || {}; capture.del = []; capture.post = []; capture.patch = [];
    await page.route('**/*', r => {
      const req = r.request(); const u = req.url(); const H = { 'access-control-allow-origin': '*', 'content-range': '0-999/1000' };
      if (u.includes('/rest/v1/')) {
        const m = req.method(); const su = new URL(u);
        if (m === 'DELETE') { capture.del.push(decodeURIComponent((su.searchParams.get('id') || '').replace(/^eq\./, ''))); return r.fulfill({ status: 200, headers: H, body: '[]' }); }
        if (m === 'POST') { try { capture.post.push(JSON.parse(req.postData() || '{}')); } catch (e) {} return r.fulfill({ status: 201, headers: H, contentType: 'application/json', body: '[]' }); }
        if (m === 'PATCH') { capture.patch.push({ url: u, body: req.postData() }); return r.fulfill({ status: 200, headers: H, body: '[]' }); }
        if (su.searchParams.get('select') === 'is_new') return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: '[{"is_new":false}]' });
        // id-scoped select (for openEditById / write-test)
        const idp = (su.searchParams.get('id') || '').replace(/^eq\./, '');
        if (idp) { const hit = (rows || []).find(x => String(x.id) === decodeURIComponent(idp)); return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: JSON.stringify(hit ? [hit] : []) }); }
        const off = +(su.searchParams.get('offset') || 0);
        return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: off > 0 ? '[]' : JSON.stringify(rows || []) });
      }
      if (u.includes('cloudinary')) return r.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'access-control-allow-origin': '*' }, body: 'FAKE' });
      if (u.includes('supabase')) return r.fulfill({ status: 200, headers: H, contentType: 'application/json', body: '[]' });
      if (u.includes('fonts.g') || u.includes('gstatic') || u.includes('googletagmanager')) return r.fulfill({ status: 200, body: '' });
      return r.continue();
    });
    await page.goto(indexUrl, { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.evaluate(() => { if (!document.getElementById('audit-rec-panel')) { var d = document.createElement('div'); d.id = 'audit-rec-panel'; document.body.appendChild(d); } });
    return page;
  }
  const runAudit = p => p.evaluate(async () => { await auditRecordings({ textContent: '', disabled: false }); return document.getElementById('audit-rec-panel').innerHTML; });

  console.log('\n[audit/scenarios regression]');

  // 1 — scenario steps with identical text across steps are NOT shadow duplicates
  {
    const cap = {};
    const p = await load([
      { id: 's1', he: 'קדימה, מהר!', ar: 'يالله', cat: 'הרחקה מהשטח', section: 'scenario', audio_url: 'u', tags: 'step5' },
      { id: 's2', he: 'קדימה, מהר!', ar: 'يالله', cat: 'הרחקה מהשטח', section: 'scenario', audio_url: '', tags: 'step10' },
      { id: 'f', he: 'שלום', ar: 'x', cat: 'ברכה', section: 'military', audio_url: 'u' },
    ], cap);
    await runAudit(p);
    const shadowHasScn = await p.evaluate(() => (window._auditShadow || []).some(r => r.section === 'scenario'));
    check('שלבי תרחיש עם טקסט זהה אינם נספרים ככפילות', shadowHasScn === false);
    await p.close();
  }

  // 2 — separator-insensitive step key; soldier vs civilian distinct
  {
    const p = await load([]);
    const r = await p.evaluate(() => ({
      variant: _scnStepKeyN({ cat: 'א — ב', tags: 'step1' }) === _scnStepKeyN({ cat: 'א - ב', tags: 'step1' })
        && _scnStepKeyN({ cat: 'א — ב', tags: 'step1' }) === _scnStepKeyN({ cat: 'א ב', tags: 'step1' }),
      civ: _scnStepKeyN({ cat: 'א — ב', tags: 'step1' }) !== _scnStepKeyN({ cat: 'א — ב', tags: 'step1 civilian' }),
      oldMiss: _scnStepKey({ cat: 'א — ב', tags: 'step1' }) !== _scnStepKey({ cat: 'א - ב', tags: 'step1' }),
    }));
    check('מפתח שלב חסין-מקף (וריאציות שם מתאחדות)', r.variant);
    check('שורת חייל ושורת אזרח נשארות נפרדות', r.civ);
    check('המפתח הישן אכן היה מפספס (הבאג שתוקן)', r.oldMiss);
    await p.close();
  }

  // 3 — display collapses variant duplicates, keeps recorded copy
  {
    const p = await load([]);
    const r = await p.evaluate(() => {
      populateFromData([
        { id: 'a', he: 'איזה בניין?', ar: 'x', cat: 'חקירה - פתיחה', section: 'scenario', audio_url: 'REC', tags: 'step1' },
        { id: 'b', he: 'איזה בניין?', ar: 'x', cat: 'חקירה — פתיחה', section: 'scenario', audio_url: '', tags: 'step1' },
      ]);
      var st = (SCENARIO || []).filter(x => /step1\b/.test(x.tags || '') && x.he === 'איזה בניין?');
      return { count: st.length, hasAudio: !!(st[0] && st[0].audio) };
    });
    check('תצוגת תרחיש: שלב כפול-וריאציה מתאחד לאחד', r.count === 1);
    check('תצוגת תרחיש: נשמר העותק המוקלט', r.hasAudio);
    await p.close();
  }

  // 4 — merge deletes only the true duplicate
  {
    const cap = {};
    const p = await load([
      { id: 'd1', cat: 'חקירה — פתיחה', tags: 'step3', he: 'א', section: 'scenario', audio_url: '' },
      { id: 'd2', cat: 'חקירה - פתיחה', tags: 'step3', he: 'א', section: 'scenario', audio_url: 'REC' },
      { id: 'c1', cat: 'חקירה — פתיחה', tags: 'step3 civilian', he: 'ב', section: 'scenario', audio_url: 'REC' },
      { id: 'u1', cat: 'חקירה — פתיחה', tags: 'step4', he: 'ג', section: 'scenario', audio_url: 'REC' },
    ], cap);
    await p.evaluate(async () => { window.confirm = () => true; window.alert = () => {}; await mergeScenarioDuplicates({ textContent: '', disabled: false }); });
    const idDel = cap.del.filter(Boolean);
    check('איחוד מוחק רק את הכפילות האמיתית (d1 בלבד)', idDel.length === 1 && idDel[0] === 'd1', idDel.join(','));
    await p.close();
  }

  // 5 — shared audio across sections; distinct words never borrow
  {
    const p = await load([]);
    const r = await p.evaluate(() => {
      populateFromData([
        { id: 'm', he: 'עצור!', ar: 'قف', cat: 'עצירת תנועה ורכב', section: 'military', audio_url: 'https://x/s.mp3' },
        { id: 's', he: 'עצור!', ar: 'قف', cat: 'זיכוי מרחוק', section: 'scenario', audio_url: '', tags: 'step1' },
        { id: 'hu', he: 'הוא', ar: 'x', cat: 'יסודות: כינויי גוף', section: 'military', audio_url: 'https://x/h.mp3' },
        { id: 'hi', he: 'היא', ar: 'x', cat: 'יסודות: כינויי גוף', section: 'military', audio_url: '' },
      ]);
      var s = (SCENARIO || []).find(x => x.he === 'עצור!'); var hi = (DB || []).find(x => x.he === 'היא');
      return { shared: !!(s && s.audio), distinct: !!(hi && !hi.audio) };
    });
    check('שמע משותף: אותו משפט מנגן בכל המדורים', r.shared);
    check('שמע משותף: מילים שונות (הוא/היא) לא מתערבבות', r.distinct);
    await p.close();
  }

  // 6 — no fuzzy near-duplicate matching (למה/כמה never paired)
  {
    const p = await load([
      { id: 'lo', he: 'למה?', ar: 'ليش', cat: 'יסודות: מילות שאלה', section: 'military', audio_url: '' },
      { id: 'ka', he: 'כמה?', ar: 'قديش', cat: 'יסודות: מילות שאלה', section: 'military', audio_url: 'REC' },
      { id: 'f', he: 'שלום', ar: 'x', cat: 'ברכה', section: 'military', audio_url: 'REC' },
    ]);
    const html = await runAudit(p);
    check('אין זיהוי "כמעט-כפילות" (למה/כמה לא זווגו)', !/כבר מוקלט כ:/.test(html) && !/מחק כפילות/.test(html));
    await p.close();
  }

  // 7 — hard-delete blocklists a built-in so it does not come back
  {
    const cap = {};
    const p = await load([{ id: 'MH', section: 'military', cat: 'יסודות: מילות שאלה', he: 'מה?' }], cap);
    const r = await p.evaluate(async () => {
      localStorage.removeItem('deleted_builtins');
      populateFromData([]);
      var before = DB.some(x => x.he === 'מה?' && x.cat === 'יסודות: מילות שאלה');
      window.confirm = () => true; window.alert = () => {};
      await auditHardDelete('MH', { textContent: '', disabled: false, parentNode: null });
      populateFromData([]);
      var after = DB.some(x => x.he === 'מה?' && x.cat === 'יסודות: מילות שאלה');
      return { before, after, blk: JSON.parse(localStorage.getItem('deleted_builtins') || '[]') };
    });
    check('מחיקה לצמיתות: מובנה קיים לפני', r.before === true);
    check('מחיקה לצמיתות: לא חוזר אחרי טעינה מחדש', r.after === false);
    check('מחיקה לצמיתות: נרשם ברשימת החסימה', r.blk.length === 1);
    check('מחיקה לצמיתות: הופעל DELETE', cap.del.indexOf('MH') !== -1);
    await p.close();
  }

  // 8/9/10 — orphan foundation hidden; covered-elsewhere not missing; headers hidden
  {
    const p = await load([
      { id: 'jan', he: 'ינואר', ar: 'x', cat: 'יסודות: חודשי השנה', section: 'military', audio_url: '' },       // orphan → hide
      { id: 'ma', he: 'מה?', ar: 'x', cat: 'יסודות: מילות שאלה', section: 'military', audio_url: '' },           // real foundation → show
      { id: 'q1', he: 'היכן הם גרים?', ar: 'x', cat: 'תשאול: חברים', section: 'military', audio_url: '' },        // covered elsewhere
      { id: 'q2', he: 'היכן הם גרים?', ar: 'x', cat: 'תשאול: אחר', section: 'military', audio_url: 'REC' },        // the recording
      { id: 'ttl', he: 'מקרה א׳ — בסיסי', ar: '', cat: 'זיכוי מרחוק', section: 'scenario', audio_url: '', tags: 'step0' }, // header → hide
      { id: 'stp', he: 'כרע ברך!', ar: 'اركع', cat: 'זיכוי מרחוק', section: 'scenario', audio_url: '', tags: 'step1' },    // real gap → show
      { id: 'f', he: 'שלום', ar: 'x', cat: 'ברכה', section: 'military', audio_url: 'REC' },
    ]);
    const html = await runAudit(p);
    check('קטגוריית יסודות יתומה (חודשים) מוסתרת', !/quickRecordById\('jan'/.test(html) && html.indexOf('חודשי השנה') === -1);
    check('קטגוריית יסודות אמיתית (מילות שאלה) מוצגת', /quickRecordById\('ma'/.test(html));
    check('משפט שמוקלט במקום אחר נספר כמכוסה (לא חסר)', !/quickRecordById\('q1'/.test(html));
    check('כותרת תרחיש (בלי ערבית) מוסתרת', !/quickRecordById\('ttl'/.test(html) && html.indexOf('מקרה א׳') === -1);
    check('שלב תרחיש אמיתי עדיין מוצג', /quickRecordById\('stp'/.test(html));
    await p.close();
  }

  // 11 — dup-check tool pre-marks ONLY empty copies; recordings protected
  {
    const p = await load([]);
    const r = await p.evaluate(() => {
      if (!document.getElementById('dupcheck-panel')) { var d = document.createElement('div'); d.id = 'dupcheck-panel'; document.body.appendChild(d); }
      window._dupGroups = [[
        { id: 'k', he: 'דירה', ar: 'دار', trans: 'dar', audio_url: 'REC', section: 'dictionary', cat: 'מקומות' },
        { id: 'e', he: 'דירה', ar: 'دار', trans: '', audio_url: '', section: 'dictionary', cat: 'x' },
        { id: 'r2', he: 'דירה', ar: 'دار', trans: 'dar', audio_url: 'REC2', section: 'dictionary', cat: 'y' },
      ]];
      renderDupGroups();
      var box = document.getElementById('dupcheck-panel');
      var chk = id => { var el = box.querySelector('input.dupdel[value="' + id + '"]'); return el ? el.checked : null; };
      return { k: chk('k'), e: chk('e'), r2: chk('r2') };
    });
    check('בדיקת כפילויות: עותק ריק מסומן למחיקה', r.e === true);
    check('בדיקת כפילויות: עותק מוקלט מוגן (לא מסומן)', r.k === false && r.r2 === false);
    await p.close();
  }

  // 12 — text id with space/slash resolves & saves (URL-encoded)
  {
    const cap = {};
    const TEXTID = 'topo עיר / כפר';
    const p = await load([{ id: TEXTID, he: 'עיר / כפר', ar: 'x', trans: 't', cat: 'יסודות: טופוגרפיה', section: 'military', audio_url: '', why: '', tags: '' }], cap);
    const r = await p.evaluate(async (TEXTID) => {
      window._adminItems = []; window.alert = () => {};
      await openEditById(TEXTID);
      var modal = document.getElementById('edit-modal');
      var opened = modal && modal.style.display !== 'none';
      var idVal = (document.getElementById('edit-id') || {}).value;
      await saveEdit(false);
      return { opened, idVal };
    }, TEXTID);
    const patchedRight = cap.patch.some(x => decodeURIComponent(x.url).includes('id=eq.' + TEXTID));
    check('מזהה טקסטואלי (רווח/לוכסן): העורך נפתח', r.opened && r.idVal === TEXTID);
    check('מזהה טקסטואלי: השמירה פונה לשורה הנכונה', patchedRight);
    await p.close();
  }

  // 13 — emergency tab is ⭐-curated: soldiers see only starred phrases; admin edit
  //      mode shows all with toggles (restores the precise, hand-picked חירום set)
  {
    const p = await load([
      { id: 'g1', he: 'עצור!', ar: 'وقف', cat: 'הוראות מיידיות', section: 'military', audio_url: '', tags: '@gold' },
      { id: 'g2', he: 'ידיים למעלה!', ar: 'إيديك لفوق', cat: 'הוראות מיידיות', section: 'military', audio_url: '', tags: '@gold' },
      { id: 'n1', he: 'למה אתה עומד באמצע הדרך?', ar: 'x', cat: 'הוראות מיידיות', section: 'military', audio_url: '' },
      { id: 'n2', he: 'תהיה בשקט עכשיו', ar: 'x', cat: 'הוראות מיידיות', section: 'military', audio_url: '' },
    ]);
    const r = await p.evaluate(() => {
      var ec = { key: 'orders', cats: ['הוראות מיידיות', 'הוראות'] };
      var curated = _emergPhrasesForCat(ec), all = _emergAllForCat(ec);
      window._adminAuth = false; window._emergEditMode = false; openEmergCat('orders');
      var soldier = (document.getElementById('emerg-items').innerHTML.match(/emerg-card-he/g) || []).length;
      window._adminAuth = true; window._emergEditMode = true; openEmergCat('orders');
      var editHtml = document.getElementById('emerg-items').innerHTML;
      return { curated: curated.length, curatedFlag: curated._curated, allCount: all.length, soldier: soldier,
        edit: (editHtml.match(/emerg-card-he/g) || []).length, toggles: (editHtml.match(/toggleEmergGold/g) || []).length };
    });
    check('חירום: חייל רואה רק משפטים מסומנים (⭐)', r.soldier === r.curated && r.curated === 2 && r.curatedFlag === true);
    check('חירום: מצב עריכה מציג הכל עם כפתורי ⭐', r.edit === r.allCount && r.toggles === r.edit && r.allCount >= 2);
    await p.close();
  }

  await browser.close();
  console.log('\n========================================');
  if (fail === 0) console.log('✅ כל ' + pass + ' בדיקות הרגרסיה עברו');
  else { console.log('❌ ' + fail + ' נכשלו מתוך ' + (pass + fail) + ':'); failures.forEach(f => console.log('   - ' + f)); }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
