import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { locationOrPrimary, scopedDb, orderNumber } from "./locations.ts";
import { brand } from "./brand.ts";

/* Online betalen via Mollie (iDEAL | Wero). De API-sleutel staat als geheim MOLLIE_API_KEY in Supabase (per klant een eigen Mollie-account). */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = () => Deno.env.get("MOLLIE_API_KEY") || "";

async function mollie(path: string, init: RequestInit = {}) {
  const r = await fetch("https://api.mollie.com/v2/" + path, { ...init, headers: { Authorization: "Bearer " + key(), "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d?.detail || "Mollie gaf een foutmelding");
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);

  /* Webhook van Mollie: alleen het betaal-ID komt binnen; de status halen we zelf op bij Mollie. */
  if (url.searchParams.get("webhook") === "1") {
    try {
      const form = await req.formData();
      const id = String(form.get("id") || "");
      if (!/^tr_[A-Za-z0-9]+$/.test(id) || !key()) return new Response("ok");
      const p = await mollie("payments/" + id);
      const loc = await locationOrPrimary(root, p?.metadata?.location);
      const orderId = String(p?.metadata?.order_id || "");
      if (!UUID.test(orderId)) return new Response("ok");
      const update: Record<string, unknown> = { online_payment_state: p.status };
      if (p.status === "paid") update.payment_status = "Betaald";
      const { error } = await scopedDb(root, loc).from("orders").update(update).eq("id", orderId).eq("mollie_payment_id", id);
      if (error) throw error;
      return new Response("ok");
    } catch (e) {
      console.error("webhook", e);
      return new Response("retry", { status: 500 });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "config") return json({ ok: true, enabled: !!key(), test: key().startsWith("test_") });
    if (!key()) return json({ ok: false, error: "Online betalen is nog niet ingesteld." }, 503);

    const location = await locationOrPrimary(root, body.location);
    const db = scopedDb(root, location), loc = location.slug;
    const orderId = String(body.order_id || "");
    if (!UUID.test(orderId)) throw Error("Onbekende bestelling");
    const { data: o, error } = await db.from("orders").select("id,order_number,total,payment,payment_status,status,mollie_payment_id,online_payment_state,created_at").eq("id", orderId).maybeSingle();
    if (error) throw error;
    if (!o) throw Error("Bestelling niet gevonden");

    if (body.action === "status") {
      let state = o.online_payment_state, paid = o.payment_status === "Betaald";
      if (!paid && o.mollie_payment_id) {
        const p = await mollie("payments/" + o.mollie_payment_id);
        state = p.status;
        if (p.status === "paid") paid = true;
        if (state !== o.online_payment_state || paid) await db.from("orders").update({ online_payment_state: state, ...(paid ? { payment_status: "Betaald" } : {}) }).eq("id", o.id).eq("mollie_payment_id", o.mollie_payment_id);
      }
      return json({ ok: true, order_number: orderNumber(location, Number(o.order_number)), total: Number(o.total), paid, state, cancelled: o.status === "Geannuleerd" });
    }

    if (body.action === "create") {
      if (!/online/i.test(String(o.payment || ""))) throw Error("Deze bestelling is niet voor online betalen gekozen.");
      if (o.payment_status === "Betaald") return json({ ok: true, paid: true });
      if (o.status === "Geannuleerd") throw Error("Deze bestelling is geannuleerd.");
      if (Date.now() - new Date(o.created_at).getTime() > 2 * 24 * 3600 * 1000) throw Error("Deze bestelling is te oud om nog online te betalen. Neem contact met ons op.");
      if (o.mollie_payment_id) {
        const existing = await mollie("payments/" + o.mollie_payment_id);
        if (existing.status === "paid") { await db.from("orders").update({ payment_status: "Betaald", online_payment_state: "paid" }).eq("id", o.id); return json({ ok: true, paid: true }); }
        if (existing.status === "open" && existing?._links?.checkout?.href) return json({ ok: true, checkout: existing._links.checkout.href });
      }
      const origin = brand.origins.includes(body.origin) ? body.origin : brand.origins[0];
      const no = orderNumber(location, Number(o.order_number));
      const p = await mollie("payments", { method: "POST", body: JSON.stringify({
        amount: { currency: "EUR", value: Number(o.total).toFixed(2) },
        description: brand.mailName + " bestelling " + no,
        redirectUrl: `${origin}/betaald?order=${o.id}&location=${loc}`,
        webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mollie-pay?webhook=1`,
        metadata: { order_id: o.id, location: loc, order_number: no },
        locale: "nl_NL",
      }) });
      const { error: ue } = await db.from("orders").update({ mollie_payment_id: p.id, online_payment_state: p.status }).eq("id", o.id);
      if (ue) throw ue;
      return json({ ok: true, checkout: p?._links?.checkout?.href });
    }

    return json({ ok: false, error: "Onbekende actie" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Onbekende fout" }, 400);
  }
});
