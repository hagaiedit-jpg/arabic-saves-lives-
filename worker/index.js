// Cloudflare Worker in front of the static site (ערבית מצילה חיים).
// Its only job: sign Cloudinary uploads for the admin, so the upload preset can be
// switched to "Signed" and nobody else can upload files to the account.
// Every other request is served from the static files exactly as before.
//
// Secrets (Cloudflare → Workers & Pages → arabicsaveslives → Settings → Variables and Secrets):
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET   (type: Secret)
// Plain vars live in wrangler.jsonc.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sign-upload') return signUpload(request, env);
    return env.ASSETS.fetch(request);
  },
};

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function signUpload(request, env) {
  if (request.method !== 'POST') return reply(405, { error: 'method' });
  if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return reply(503, { error: 'not_configured' });
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(auth)) return reply(401, { error: 'login' });

  // The database decides: is_admin() reads the email inside the verified login token.
  let isAdmin = false;
  try {
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, authorization: auth, 'content-type': 'application/json' },
      body: '{}',
    });
    if (r.status === 401) return reply(401, { error: 'expired' });
    isAdmin = r.ok && (await r.json()) === true;
  } catch (e) {
    return reply(502, { error: 'auth_unreachable' });
  }
  if (!isAdmin) return reply(403, { error: 'not_admin' });

  // Cloudinary signature: sorted params joined with '&', then the API secret, SHA-1 hex.
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { timestamp: String(timestamp), upload_preset: env.CLOUDINARY_PRESET };
  const toSign = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('&');
  const signature = await sha1hex(toSign + env.CLOUDINARY_API_SECRET);
  return reply(200, {
    signature, timestamp, api_key: env.CLOUDINARY_API_KEY,
    upload_preset: env.CLOUDINARY_PRESET, cloud: env.CLOUDINARY_CLOUD,
  });
}

export async function sha1hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
