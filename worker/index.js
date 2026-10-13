// Cloudflare Worker in front of the static site (ערבית מצילה חיים).
// Every request that isn't /api/... is served from the static files exactly as before.
//
//   POST /api/sign-upload    admin only: signs a Cloudinary upload (preset is "Signed")
//   POST /api/audio-session  approved member/admin: sets a 7-day audio cookie
//   GET  /api/audio/<id>.<ext>  plays a recording — only with a valid audio cookie.
//        Recordings can be "authenticated" (closed) on Cloudinary; this route signs
//        the delivery URL server-side, so a leaked link never works on its own.
//   POST /api/audio-admin    admin only: move recordings closed/open (Cloudinary rename)
//
// Secrets (Cloudflare → Workers & Pages → arabicsaveslives → Settings → Variables and Secrets):
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET   (type: Secret)
// Plain vars live in wrangler.jsonc.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/sign-upload') return signUpload(request, env, url);
    if (p === '/api/audio-session') return audioSession(request, env);
    if (p.startsWith('/api/audio/')) return audio(request, env, url);
    if (p === '/api/audio-admin') return audioAdmin(request, env);
    return env.ASSETS.fetch(request);
  },
};

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...(extra || {}) } });

function cloudKeys(env) {
  // Trim: a value pasted into the dashboard with a stray space/newline breaks signatures.
  return { apiKey: String(env.CLOUDINARY_API_KEY || '').trim(), apiSecret: String(env.CLOUDINARY_API_SECRET || '').trim() };
}
function notConfigured(env) {
  // Names only (never values) — catches typos and keys saved in the wrong place.
  const missing = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter((n) => !String(env[n] || '').trim());
  const seen = Object.keys(env).filter((n) => /cloud|api|key|secret/i.test(n) && n !== 'CLOUDINARY_CLOUD');
  return reply(503, { error: 'not_configured', missing, seen });
}

// Who is calling? The database decides, from the email inside the verified login token.
// Returns 'admin' | 'member' | 'none' | 'expired'; throws if the database can't be reached.
export async function roleOf(env, auth) {
  if (!/^Bearer\s+\S+$/.test(auth || '')) return 'none';
  const ask = async (fn) => {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, authorization: auth, 'content-type': 'application/json' },
      body: '{}',
    });
    if (r.status === 401) return 'expired';
    return r.ok && (await r.json()) === true;
  };
  const a = await ask('is_admin');
  if (a === 'expired') return 'expired';
  if (a === true) return 'admin';
  return (await ask('is_member')) === true ? 'member' : 'none';
}

// ---------------------------------------------------------------- uploads
export async function signUpload(request, env, url) {
  if (request.method !== 'POST') return reply(405, { error: 'method' });
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(auth)) return reply(401, { error: 'login' });
  let role;
  try { role = await roleOf(env, auth); } catch (e) { return reply(502, { error: 'auth_unreachable' }); }
  if (role === 'expired') return reply(401, { error: 'expired' });
  if (role !== 'admin') return reply(403, { error: 'not_admin' });

  const { apiKey, apiSecret } = cloudKeys(env);
  if (!apiKey || !apiSecret) return notConfigured(env);

  // Cloudinary signature: sorted params joined with '&', then the API secret, SHA-1 hex.
  // ?private=1 → the new recording is stored closed ("authenticated"), like the rest.
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { timestamp: String(timestamp), upload_preset: env.CLOUDINARY_PRESET };
  if (url && url.searchParams.get('private') === '1') params.type = 'authenticated';
  const toSign = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('&');
  // SHA-1 is Cloudinary's default; accounts set to SHA-256 need the other one.
  const signature = await digestHex('SHA-1', toSign + apiSecret);
  const signature256 = await digestHex('SHA-256', toSign + apiSecret);
  return reply(200, {
    signature, signature256, timestamp, api_key: apiKey, type: params.type || 'upload',
    upload_preset: env.CLOUDINARY_PRESET, cloud: env.CLOUDINARY_CLOUD,
  });
}

// ---------------------------------------------------------------- audio
const COOKIE = 'asl_audio';
const COOKIE_DAYS = 7;
const AUDIO_EXT = /^[A-Za-z0-9]{1,6}$/;   // the file type Cloudinary reports (webm, mp4, mkv, …)
// A Cloudinary public id: no control chars, no backslash, no ".." segment.
const safeId = (pid) => pid.length >= 1 && pid.length <= 300 && !/[\u0000-\u001f\\]/.test(pid) && !pid.split('/').some((x) => x === '..' || x === '.' || x === '');
// As Cloudinary's SDKs write ids in URLs (and sign them): %-encoded, ':' kept.
const encId = (pid) => pid.split('/').map((x) => encodeURIComponent(x).replace(/%3A/g, ':')).join('/');

async function hmacKey(apiSecret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret + '|asl-audio-cookie-v1'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function makeCookieValue(apiSecret, exp) {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(apiSecret), new TextEncoder().encode('audio:' + exp));
  return exp + '.' + b64url(mac);
}
export async function cookieValid(apiSecret, value, now = Date.now()) {
  const m = /^(\d{10,13})\.([A-Za-z0-9_-]{20,})$/.exec(value || '');
  if (!m || Number(m[1]) < now) return false;
  return (await makeCookieValue(apiSecret, m[1])) === value;
}
function readCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

export async function audioSession(request, env) {
  if (request.method !== 'POST') return reply(405, { error: 'method' });
  const { apiSecret } = cloudKeys(env);
  if (!apiSecret) return notConfigured(env);
  const clear = { 'set-cookie': `${COOKIE}=; Path=/api/audio; Max-Age=0; HttpOnly; Secure; SameSite=Lax` };
  let role;
  try { role = await roleOf(env, request.headers.get('authorization') || ''); } catch (e) { return reply(502, { error: 'auth_unreachable' }); }
  if (role === 'expired') return reply(401, { error: 'expired' });
  if (role !== 'admin' && role !== 'member') return reply(403, { error: 'not_member' }, clear);
  const exp = Date.now() + COOKIE_DAYS * 86400000;
  const value = await makeCookieValue(apiSecret, exp);
  return reply(200, { ok: true, exp, role }, {
    'set-cookie': `${COOKIE}=${value}; Path=/api/audio; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  });
}

// "[v<version>/]<public_id>.<ext>" from the request path; public ids may contain folders.
// Closed (authenticated) files are only found WITH their version number in the link.
export function parseAudioPath(pathname) {
  let rest;
  try { rest = decodeURIComponent(pathname.slice('/api/audio/'.length)); } catch (e) { return null; }
  let ver = '';
  const vm = /^v(\d{1,12})\/(.+)$/.exec(rest);
  if (vm) { ver = vm[1]; rest = vm[2]; }
  const dot = rest.lastIndexOf('.');
  if (dot < 1) return null;
  const pid = rest.slice(0, dot), ext = rest.slice(dot + 1);
  if (!safeId(pid) || !AUDIO_EXT.test(ext)) return null;
  return { pid, ext, ver };
}

// Cloudinary signed delivery URL: "s--" + first 8 chars of URL-safe base64 of
// SHA-1(transformation/public_id.ext + api_secret) + "--". No version in the URL.
export async function signedAudioUrl(cloud, apiSecret, pid, ext) {
  const toSign = 'f_mp3/' + encId(pid) + '.' + ext;
  const sha = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign + apiSecret));
  return `https://res.cloudinary.com/${cloud}/video/authenticated/s--${b64url(sha).slice(0, 8)}--/${toSign}`;
}
// The ways a closed recording can be addressed (tried in order; the first that plays wins).
async function signPath(apiSecret, path) {
  const sha = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(path + apiSecret));
  return 's--' + b64url(sha).slice(0, 8) + '--';
}
export async function closedCandidates(cloud, apiSecret, pid, ext, ver) {
  const base = `https://res.cloudinary.com/${cloud}/video/authenticated/`;
  const enc = encId(pid);
  // Verified live: closed files need the version in the link; the signature covers
  // transformation + id (not the version), as in Cloudinary's SDKs.
  if (ver) return [['authenticated', base + (await signPath(apiSecret, 'f_mp3/' + enc + '.' + ext)) + '/f_mp3/v' + ver + '/' + enc + '.' + ext]];
  return [
    ['authenticated', base + (await signPath(apiSecret, 'f_mp3/' + enc + '.' + ext)) + '/f_mp3/' + enc + '.' + ext],
    ['authenticated-raw-sig', base + (await signPath(apiSecret, 'f_mp3/' + pid + '.' + ext)) + '/f_mp3/' + enc + '.' + ext],
    ['authenticated-original', base + (await signPath(apiSecret, enc + '.' + ext)) + '/' + enc + '.' + ext],
  ];
}
export function publicAudioUrl(cloud, pid, ext, ver) {
  return `https://res.cloudinary.com/${cloud}/video/upload/f_mp3/${ver ? 'v' + ver + '/' : ''}${encId(pid)}.${ext}`;
}

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

export async function audio(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, { error: 'method' });
  const { apiSecret } = cloudKeys(env);
  if (!apiSecret) return notConfigured(env);
  if (!(await cookieValid(apiSecret, readCookie(request, COOKIE)))) return reply(401, { error: 'login' });
  const a = parseAudioPath(url.pathname);
  if (!a) return reply(400, { error: 'bad_path' }, { 'x-asl-upstream': 'bad_path:' + url.pathname.slice(11, 80) });

  const fwd = {};
  const range = request.headers.get('range');
  if (range) fwd.range = range;
  const tried = [];
  // Closed copy first (after the move), then the open one (before / during the move).
  for (const [label, u] of [
    ...(await closedCandidates(env.CLOUDINARY_CLOUD, apiSecret, a.pid, a.ext, a.ver)),
    ['public', publicAudioUrl(env.CLOUDINARY_CLOUD, a.pid, a.ext, a.ver)],
  ]) {
    let r;
    try { r = await fetch(u, { method: request.method, headers: fwd }); } catch (e) { tried.push(label + ':net'); continue; }
    if (r.ok) {
      const h = new Headers();
      for (const k of PASS) { const v = r.headers.get(k); if (v) h.set(k, v); }
      h.set('cache-control', 'private, max-age=86400');
      h.set('x-asl-source', label.startsWith('authenticated') ? 'authenticated' : label);
      h.set('x-asl-variant', label);
      return new Response(r.body, { status: r.status, headers: h });
    }
    tried.push(label + ':' + r.status + (r.headers.get('x-cld-error') ? '(' + r.headers.get('x-cld-error').slice(0, 60) + ')' : ''));
  }
  return reply(404, { error: 'not_found', tried }, { 'x-asl-upstream': tried.join(',') });
}

// ---------------------------------------------------------------- admin: close/open recordings
// body: { action: 'protect' | 'unprotect' | 'probe', items: [{ pid, ext }] }  (max 20 per call)
export async function audioAdmin(request, env) {
  if (request.method !== 'POST') return reply(405, { error: 'method' });
  let role;
  try { role = await roleOf(env, request.headers.get('authorization') || ''); } catch (e) { return reply(502, { error: 'auth_unreachable' }); }
  if (role === 'expired') return reply(401, { error: 'expired' });
  if (role !== 'admin') return reply(403, { error: 'not_admin' });
  const { apiKey, apiSecret } = cloudKeys(env);
  if (!apiKey || !apiSecret) return notConfigured(env);
  let body;
  try { body = await request.json(); } catch (e) { return reply(400, { error: 'bad_json' }); }
  const items = Array.isArray(body && body.items) ? body.items.slice(0, 20) : [];
  const action = body && body.action;
  const results = [];
  for (const it of items) {
    const pid = String((it && it.pid) || '');
    const ext = String((it && it.ext) || 'webm');
    if (!safeId(pid)) { results.push({ pid, ok: false, error: 'bad_id' }); continue; }
    if (action === 'probe') {
      // Each address, with Cloudinary's own error text; plus what Cloudinary's
      // admin API knows about the file (does it exist as closed / open, its format).
      const st = { details: [] };
      const basic = 'Basic ' + btoa(apiKey + ':' + apiSecret);
      let ver = '';
      for (const t of ['authenticated', 'upload']) {
        try {
          const r = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD}/resources/video/${t}/${encId(pid)}`, { headers: { authorization: basic } });
          if (r.ok) { const d = await r.json(); ver = ver || String(d.version || ''); st.details.push('api:' + t + '=exists v' + d.version + ' ' + d.format); st['api_' + t] = true; }
          else st.details.push('api:' + t + '=' + r.status);
        } catch (e) { st.details.push('api:' + t + '=net'); }
      }
      const enc = encId(pid), base = `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD}/video/authenticated/`;
      const extra = ver ? [
        ['auth+ver', base + (await signPath(apiSecret, 'f_mp3/' + enc + '.' + ext)) + '/f_mp3/v' + ver + '/' + enc + '.' + ext],
        ['auth+ver-signed', base + (await signPath(apiSecret, 'f_mp3/v' + ver + '/' + enc + '.' + ext)) + '/f_mp3/v' + ver + '/' + enc + '.' + ext],
        ['public+ver', `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD}/video/upload/f_mp3/v${ver}/${enc}.${ext}`],
      ] : [];
      for (const [label, u] of [...(await closedCandidates(env.CLOUDINARY_CLOUD, apiSecret, pid, ext)), ...extra, ['public', publicAudioUrl(env.CLOUDINARY_CLOUD, pid, ext)]]) {
        try {
          const r = await fetch(u, { method: 'GET', headers: { range: 'bytes=0-1' } });
          const code = r.ok ? 200 : r.status;
          if (label === 'authenticated' || label === 'public') st[label] = code;
          st.details.push(label + ':' + code + (r.headers.get('x-cld-error') ? '(' + r.headers.get('x-cld-error').slice(0, 80) + ')' : ''));
        } catch (e) { st.details.push(label + ':net'); }
      }
      results.push({ pid, ok: true, ...st });
      continue;
    }
    if (action !== 'protect' && action !== 'unprotect') { results.push({ pid, ok: false, error: 'bad_action' }); continue; }
    const from = action === 'protect' ? 'upload' : 'authenticated';
    const to = action === 'protect' ? 'authenticated' : 'upload';
    const params = {
      from_public_id: pid, invalidate: 'true', overwrite: 'false',
      timestamp: String(Math.floor(Date.now() / 1000)), to_public_id: pid, to_type: to, type: from,
    };
    const toSign = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('&');
    const form = new URLSearchParams({ ...params, api_key: apiKey, signature: await digestHex('SHA-1', toSign + apiSecret) });
    try {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD}/video/rename`, { method: 'POST', body: form });
      let d = {};
      try { d = await r.json(); } catch (e) {}
      if (r.ok) results.push({ pid, ok: true, type: d.type || to });
      else results.push({ pid, ok: false, status: r.status, error: (d.error && d.error.message) || String(r.status) });
    } catch (e) {
      results.push({ pid, ok: false, error: 'net' });
    }
  }
  return reply(200, { action, results });
}

export async function digestHex(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const sha1hex = (text) => digestHex('SHA-1', text);
