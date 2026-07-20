// ============================================================================
//  Supabase Edge Function: Stripe webhook -> update public.subscriptions
//  פונקציית שרת שמקבלת עדכונים מ-Stripe ומעדכנת את מצב המנוי.
//
//  זהו הגורם היחיד שכותב לטבלת subscriptions (עם service role).
//  הדפדפן לעולם לא קובע מי מנוי — רק העדכון המאומת הזה מ-Stripe.
//
//  פריסה:  supabase functions deploy stripe-webhook --no-verify-jwt
//  סודות:  supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
//                              SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//  ב-Stripe: הפנו webhook ל-URL של הפונקציה, אירועים:
//    checkout.session.completed, customer.subscription.updated,
//    customer.subscription.deleted, invoice.payment_failed
// ============================================================================
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// map Stripe status -> our status
function mapStatus(s: string): string {
  if (s === "active" || s === "trialing" || s === "past_due" || s === "canceled") return s;
  return "inactive";
}

// upsert the subscription row for a given Supabase user id
async function upsert(userId: string, fields: Record<string, unknown>) {
  const { error } = await admin.from("subscriptions").upsert(
    { user_id: userId, updated_at: new Date().toISOString(), ...fields },
    { onConflict: "user_id" },
  );
  if (error) console.error("subscriptions upsert failed:", error);
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
    );
  } catch (err) {
    return new Response(`bad signature: ${err}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        // Pass the Supabase user id when creating the Checkout Session:
        //   metadata: { supabase_user_id: <uid> }  (or client_reference_id)
        const userId = (s.metadata?.supabase_user_id as string) || (s.client_reference_id as string);
        if (userId && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsert(userId, {
            status: mapStatus(sub.status),
            provider: "stripe",
            provider_customer_id: sub.customer as string,
            provider_subscription_id: sub.id,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id as string;
        if (userId) {
          await upsert(userId, {
            status: event.type === "customer.subscription.deleted" ? "canceled" : mapStatus(sub.status),
            provider: "stripe",
            provider_customer_id: sub.customer as string,
            provider_subscription_id: sub.id,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString() : null,
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error("handler error:", err);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  });
});
