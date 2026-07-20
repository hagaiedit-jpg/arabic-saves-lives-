// ============================================================================
//  Supabase Edge Function: media-sign
//  מחזיר URL חתום קצר-מועד לקובץ אודיו premium — רק למנוי פעיל.
//
//  הזרימה: הקליינט שולח את ה-public_id של ההקלטה + הטוקן שלו (Authorization).
//  הפונקציה מאמתת את המשתמש, בודקת מנוי פעיל, ומחזירה URL חתום שתקף לזמן קצר.
//
//  פריסה:  supabase functions deploy media-sign
//  סודות:  supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//            CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \
//            CLOUDINARY_AUTH_KEY_ID=... CLOUDINARY_AUTH_KEY_SECRET=...
//
//  דרישות Cloudinary: אודיו premium מועלה כ-type: authenticated, ומופעל
//  Token-based authentication (Auth key) בהגדרות ה-Security של החשבון.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { v2 as cloudinary } from "https://esm.sh/cloudinary@2.5.1?target=deno";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

cloudinary.config({
  cloud_name: Deno.env.get("CLOUDINARY_CLOUD_NAME"),
  api_key: Deno.env.get("CLOUDINARY_API_KEY"),
  api_secret: Deno.env.get("CLOUDINARY_API_SECRET"),
  secure: true,
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function deny(status: number, msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return deny(405, "method not allowed");

  // 1) מי המשתמש? (מאמתים את ה-JWT מול Supabase Auth)
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return deny(401, "missing token");
  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) return deny(401, "invalid session");

  // 2) האם מנוי פעיל? (service role קורא ישירות את מצב המנוי)
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  const active = !!sub &&
    ["active", "trialing"].includes(sub.status) &&
    (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
  if (!active) return deny(403, "no active subscription");

  // 3) איזה קובץ ביקשו?
  let public_id = "";
  try { public_id = (await req.json()).public_id || ""; } catch { /* ignore */ }
  if (!public_id) return deny(400, "missing public_id");

  // 4) auth-token קצר-מועד (שעה) שמתיר גישה רק לקובץ המבוקש
  const token = cloudinary.utils.generate_auth_token({
    key: Deno.env.get("CLOUDINARY_AUTH_KEY_ID")!,
    // deno-lint-ignore no-explicit-any
    ...( { key_secret: Deno.env.get("CLOUDINARY_AUTH_KEY_SECRET") } as any ),
    acl: `/*/${public_id}.*`,
    duration: 3600,
  });

  // 5) URL של הנכס ה-authenticated, מסופק כ-mp3 לתאימות מלאה
  const url = cloudinary.url(public_id, {
    resource_type: "video", // audio is delivered under the video resource type
    type: "authenticated",
    format: "mp3",
    secure: true,
  });

  return new Response(
    JSON.stringify({ url: `${url}?__cld_token__=${token}`, expires_in: 3600 }),
    { headers: { ...CORS, "content-type": "application/json" } },
  );
});
