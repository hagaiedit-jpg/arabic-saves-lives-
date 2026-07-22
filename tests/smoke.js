#!/usr/bin/env node
/*
 * Smoke tests — "ערבית מצילה חיים"
 * Run BEFORE every deploy:   node tests/smoke.js
 * Requires Playwright:       npm i -D playwright   (or a global install)
 * Optional custom browser:   SMOKE_CHROME=/path/to/chrome node tests/smoke.js
 *
 * The suite loads index.html from disk with a STUBBED backend (Supabase
 * returns []) so it validates the app itself: built-in content, search,
 * dormant flags, backup/queue machinery, error log — with zero network.
 */
const path = require('path');
const fs = require('fs');

function resolvePlaywright() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright',
  ];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try next */ }
  }
  // last resort: dynamic import of the mjs path
  return null;
}

async function main() {
  let pw = resolvePlaywright();
  if (!pw) {
    try { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
    catch (e) { console.error('Playwright not found. Run: npm i -D playwright'); process.exit(2); }
  }
  const { chromium } = pw;

  const repo = path.resolve(__dirname, '..');
  const indexUrl = 'file://' + path.join(repo, 'index.html');
  if (!fs.existsSync(path.join(repo, 'index.html'))) {
    console.error('index.html not found next to tests/'); process.exit(2);
  }

  const launchOpts = {};
  if (process.env.SMOKE_CHROME) launchOpts.executablePath = process.env.SMOKE_CHROME;
  else {
    // Fall back to the preinstalled chromium in Claude/CI containers
    const guess = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    if (fs.existsSync(guess)) launchOpts.executablePath = guess;
  }

  const browser = await chromium.launch(launchOpts);
  let pass = 0, fail = 0;
  const failures = [];
  function check(name, ok, detail) {
    if (ok) { pass++; console.log('  ✓ ' + name); }
    else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
  }

  // Shared route stubs: no real network, Supabase empty, fake audio bytes.
  async function newPage(opts) {
    opts = opts || {};
    const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
    page._googleReqs = 0;
    page.on('request', r => { if (/google|gstatic|googletagmanager/i.test(r.url())) page._googleReqs++; });
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('/auth/v1/otp')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (u.includes('/auth/v1/verify')) {
        const body = r.request().postData() || '';
        if (body.includes('"token":"111111"')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok', refresh_token: 'r', user: { id: 'u1' } }) });
        return r.fulfill({ status: 400, contentType: 'application/json', body: '{"msg":"invalid"}' });
      }
      if (u.includes('/rest/v1/subscriptions')) return r.fulfill({ status: 200, contentType: 'application/json', body: opts.subActive ? JSON.stringify([{ status: 'active', current_period_end: '2030-01-01T00:00:00Z' }]) : '[]' });
      if (u.includes('supabase')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (u.includes('cloudinary')) return r.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'access-control-allow-origin': '*' }, body: 'FAKEAUDIO' });
      if (u.includes('fonts.g') || u.includes('gstatic') || u.includes('googletagmanager')) return r.fulfill({ status: 200, body: '' });
      return r.continue();
    });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page._errs = errs;
    await page.goto(indexUrl + (opts.query || ''), { waitUntil: 'load' });
    await page.waitForTimeout(opts.wait || 1100);
    for (const t of ['לא, תודה', 'כניסה לערכה']) {
      try { await page.locator('text=' + t).first().click({ timeout: 900 }); await page.waitForTimeout(150); } catch (e) { /* landing variant */ }
    }
    return page;
  }

  // ---------------------------------------------------------------- suite 1
  console.log('\n[1] טעינה בסיסית + תוכן מובנה (backend ריק)');
  {
    const p = await newPage();
    check('אפס שגיאות JS בטעינה', p._errs.length === 0, p._errs[0]);
    const d = await p.evaluate(() => {
      const cats = {}; (DICT || []).forEach(x => { cats[x.cat] = 1; });
      return { dict: DICT.length, scn: SCENARIO.length, ncat: Object.keys(cats).length };
    });
    check('מילון מובנה ≥ 400 מילים (בפועל ' + d.dict + ')', d.dict >= 400);
    check('מילון ≥ 19 נושאים (בפועל ' + d.ncat + ')', d.ncat >= 19);
    check('תרחישים מובנים ≥ 190 (בפועל ' + d.scn + ')', d.scn >= 190);
    // smart dictionary search
    const s = await p.evaluate(() => {
      buildSmartDictIndex();
      const idx = window.SMART_DICT_INDEX || {};
      return { built: Object.keys(idx).length > 1000, word: !!idx[dictNorm('מחסום')] };
    });
    check('אינדקס מילון חכם נבנה (>1000 מילים)', s.built);
    check('חיפוש "מחסום" מוצא ערך', s.word);
    // core function surface
    const fns = await p.evaluate(() => ['downloadBackup', 'downloadAudioBackup', '_makeZip', 'renderRecordWorklist', 'startRecQueue', '_rebuildRecNav', 'renderErrLog', 'toggleSecureMode'].filter(f => typeof window[f] !== 'function' && typeof eval(f) !== 'function'));
    check('כל פונקציות הליבה קיימות', fns.length === 0, fns.join(','));
    // ZIP writer sanity: header bytes PK\x03\x04
    const zipOk = await p.evaluate(() => { const z = _makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]); return z[0] === 0x50 && z[1] === 0x4b && z[2] === 3 && z[3] === 4; });
    check('_makeZip מפיק ZIP תקין (PK header)', zipOk);
    // Every scenario category in the data must be VISIBLE in the grid —
    // either listed in SCN_CATEGORIES or rendered by the auto fallback group.
    const scnVis = await p.evaluate(() => {
      const cats = {}; (SCENARIO || []).forEach(x => { if (x.cat) cats[x.cat] = 1; });
      // expand every group (incl. the auto fallback) so cube titles render
      window._scnExpandedCats = window._scnExpandedCats || {};
      SCN_CATEGORIES.forEach(c => { window._scnExpandedCats[c.id] = true; });
      window._scnExpandedCats['cat-extra'] = true;
      renderScnGrid();
      const gridHtml = document.getElementById('scn-grid') ? document.getElementById('scn-grid').innerHTML : '';
      const missing = Object.keys(cats).filter(c => gridHtml.indexOf(c.replace(/"/g, '&quot;')) === -1 && gridHtml.indexOf(c) === -1);
      return { total: Object.keys(cats).length, missing };
    });
    check('כל קטגוריות התרחישים מוצגות ברשת (' + scnVis.total + ')', scnVis.missing.length === 0, scnVis.missing.join(','));
    await p.close();
  }

  // ---------------------------------------------------------------- suite 2
  console.log('\n[2] מצב מאובטח (SECURE_MODE)');
  {
    const p = await newPage({ query: '?secure=1' });
    const flag = await p.evaluate(() => window.SECURE_MODE);
    check('הדגל דלוק עם ?secure=1', flag === true);
    check('אפס קריאות לגוגל במצב מאובטח', p._googleReqs === 0, String(p._googleReqs));
    await p.close();
    const q = await newPage();
    check('ברירת מחדל: SECURE_MODE כבוי', (await q.evaluate(() => window.SECURE_MODE)) === false);
    await q.close();
  }

  // ---------------------------------------------------------------- suite 3
  console.log('\n[3] שכבת מסחר רדומה (COMMERCE_LOGIN)');
  {
    const off = await newPage();
    check('ברירת מחדל: מסך התחברות מוסתר', (await off.evaluate(() => document.getElementById('cl-overlay').style.display)) !== 'block');
    await off.close();
    const p = await newPage({ query: '?login=1', subActive: true });
    check('עם ?login=1 המסך מוצג', (await p.evaluate(() => document.getElementById('cl-overlay').style.display)) === 'block');
    await p.fill('#cl-phone', '050-123-4567');
    await p.click('#cl-send-btn'); await p.waitForTimeout(250);
    check('שלב הקוד נפתח אחרי שליחה', (await p.evaluate(() => document.getElementById('cl-step-code').style.display)) === 'block');
    await p.fill('#cl-code', '111111');
    await p.click('#cl-verify-btn'); await p.waitForTimeout(700);
    const done = await p.evaluate(() => ({ sess: !!clSession(), overlay: document.getElementById('cl-overlay').style.display }));
    check('קוד נכון → סשן נשמר והמסך נסגר', done.sess && done.overlay === 'none');
    const ent = await p.evaluate(async () => {
      localStorage.setItem('cl_ent', JSON.stringify({ ok: true, at: Date.now() }));
      const fresh = clHasAccess();
      localStorage.setItem('cl_ent', JSON.stringify({ ok: true, at: Date.now() - 20 * 86400000 }));
      const expired = clHasAccess();
      const granted = await clRefreshEntitlement();
      return { fresh, expired, granted };
    });
    check('זכאות: טרייה=כן, בת 20 יום=לא, מנוי פעיל מרענן=כן', ent.fresh && !ent.expired && ent.granted);
    check('אפס שגיאות JS בזרימת ההתחברות', p._errs.length === 0, p._errs[0]);
    await p.close();
  }

  // ---------------------------------------------------------------- suite 4
  console.log('\n[4] יומן שגיאות');
  {
    const p = await newPage();
    const r = await p.evaluate(() => {
      localStorage.removeItem('err_log');
      window.dispatchEvent(new ErrorEvent('error', { message: 'smoke-test-error', filename: 'x.js', lineno: 1 }));
      const log = JSON.parse(localStorage.getItem('err_log') || '[]');
      renderErrLog();
      const listEl = document.getElementById('errlog-list');
      return { captured: log.length === 1 && log[0].msg === 'smoke-test-error', rendered: !!listEl && listEl.innerHTML.includes('smoke-test-error') };
    });
    check('שגיאה נלכדת ל-err_log', r.captured);
    check('renderErrLog מציג אותה', r.rendered);
    await p.close();
  }

  await browser.close();
  console.log('\n========================================');
  console.log(fail === 0 ? `✅ כל ${pass} הבדיקות עברו` : `❌ ${fail} נכשלו, ${pass} עברו`);
  if (fail) failures.forEach(f => console.log('   - ' + f));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
