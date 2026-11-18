import { scopedDb, authorizedService, orderNumber } from "./locations.ts";
import { brand } from "./brand.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Bestelmails (bevestiging klant + melding restaurant) uit order_email_outbox, voor alle geopende vestigingen.
// Geheimen staan in Supabase Edge Function Secrets. Aanroepen alleen met de service-sleutel.

const FROM = brand.mailName + " <" + brand.mailFrom + ">";
const WEBSITE = new URL(brand.adminUrl).origin;
const LOGO_URL = brand.orderMailLogoUrl;
const respond = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const escapeHTML = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
const money = (value: unknown) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(value) || 0);

function template(title: string, body: string) {
  const logo = /^https:\/\//i.test(LOGO_URL) ? `<img src="${escapeHTML(LOGO_URL)}" alt="${brand.mailName}" width="110" style="display:block;max-width:110px;height:auto;margin:0 auto 12px;border:0">` : "";
  const heading = brand.headerLines.map((line, i) => `<div style="font:bold ${i === 0 ? 30 : 25}px Georgia,serif;color:#fff;letter-spacing:1px;line-height:${i === 0 ? 1.1 : 1.3}">${line}</div>`).join("");
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,Helvetica,sans-serif;color:#262222">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f0e8"><tr><td align="center" style="padding:20px 8px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#fffaf4;border-collapse:collapse">
<tr><td align="center" style="background:#9d0e0d;padding:30px 20px 25px;border-bottom:7px solid #f3c35a">${logo}${heading}<div style="font:italic 20px Georgia,serif;color:#ffd56c;margin-top:9px">${brand.tagline}</div></td></tr>
<tr><td style="padding:30px 26px;background:#fffaf4"><h1 style="margin:0 0 18px;text-align:center;font:bold 29px Georgia,serif;color:#a00d09">${escapeHTML(title)}</h1><div style="font-size:15px;line-height:1.65;color:#262222">${body}</div></td></tr>
<tr><td align="center" style="background:#9d0e0d;border-top:7px solid #f3c35a;padding:20px"><div style="font:italic 17px Georgia,serif;color:#ffd56c;margin-bottom:8px">${brand.tagline}</div><a href="${WEBSITE}" style="color:#fff;font-size:13px">Bestellen bij ${brand.mailName}</a></td></tr>
</table></td></tr></table></body></html>`;
}
function message(order: Record<string, unknown>, kind: "restaurant" | "customer", location:any) {
  const orderNumberText = orderNumber(location, order.order_number);
  const items = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];

  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #ece7dc;font-size:15px;color:#2f2f2f;">
        ${escapeHTML(item.qty)}× ${escapeHTML(item.name)}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #ece7dc;text-align:right;font-size:15px;color:#2f2f2f;">
        ${money(Number(item.qty) * Number(item.price))}
      </td>
    </tr>
  `).join("");

  const pickup = order.method === "Afhalen";

  const infoBlock = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 22px 0;background:#fff6e8;border:1px solid #efd8a8;border-radius:12px;">
      <tr>
        <td style="padding:18px 18px 12px 18px;">
          <div style="font-family:Georgia,serif;font-size:20px;color:#8b090c;font-weight:bold;margin-bottom:10px;">
            Bestelgegevens
          </div>
          <div style="font-size:15px;line-height:1.8;color:#2f2f2f;">
            <strong>Bestelnummer:</strong> ${escapeHTML(orderNumberText)}<br>
            <strong>Bestelwijze:</strong> ${escapeHTML(order.method)}<br>
            <strong>Datum:</strong> ${escapeHTML(order.requested_date)}<br>
            <strong>Tijd:</strong> ${escapeHTML(String(order.requested_time ?? "").slice(0, 5))}<br>
            <strong>${pickup ? "Afhalen" : "Bezorgadres"}:</strong>
            ${pickup ? (location.is_primary ? "Op locatie" : escapeHTML(location.address)) : `${escapeHTML(order.address)}, ${escapeHTML(order.city)}`}<br>
            <strong>Betaling:</strong> ${escapeHTML(order.payment)}
          </div>
        </td>
      </tr>
    </table>
  `;

  const orderTable = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:10px 0 22px 0;border-collapse:collapse;">
      <tr>
        <td colspan="2" style="padding-bottom:10px;font-family:Georgia,serif;font-size:22px;color:#8b090c;font-weight:bold;">
          Besteloverzicht
        </td>
      </tr>
      ${itemRows}
      <tr><td style="padding:12px 0">Gerechten</td><td style="text-align:right">${money(order.subtotal ?? items.reduce((sum,item)=>sum+Number(item.qty)*Number(item.price),0))}</td></tr>
      <tr><td style="padding:12px 0">${pickup ? "Afhalen" : "Bezorgkosten"}</td><td style="text-align:right">${pickup ? "Gratis" : Number(order.delivery_fee||0)===0 ? "Gratis" : money(order.delivery_fee)}</td></tr>
      <tr>
        <td style="padding:16px 0 0 0;font-size:17px;color:#2f2f2f;">
          <strong>Totaal</strong>
        </td>
        <td style="padding:16px 0 0 0;text-align:right;font-size:19px;color:#8b090c;">
          <strong>${money(order.total)}</strong>
        </td>
      </tr>
    </table>
  `;

  const customerIntro = `
    <p style="margin:0 0 14px 0;">Hoi ${escapeHTML(order.customer_name)},</p>
    <p style="margin:0 0 14px 0;">
      Bedankt voor je bestelling bij <strong>${brand.mailName}</strong>!  
      We hebben je bestelling goed ontvangen.
    </p>
    <p style="margin:0 0 14px 0;">
      Hieronder zie je het overzicht van je bestelling.
    </p>
  `;

  const restaurantIntro = `
    <p style="margin:0 0 14px 0;">
      Er is een <strong>nieuwe bestelling</strong> geplaatst.
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 22px 0;background:#fff6e8;border:1px solid #efd8a8;border-radius:12px;">
      <tr>
        <td style="padding:18px;">
          <div style="font-family:Georgia,serif;font-size:20px;color:#8b090c;font-weight:bold;margin-bottom:10px;">
            Klantgegevens
          </div>
          <div style="font-size:15px;line-height:1.8;color:#2f2f2f;">
            <strong>Naam:</strong> ${escapeHTML(order.customer_name)}<br>
            <strong>Telefoon:</strong> ${escapeHTML(order.phone)}<br>
            <strong>E-mail:</strong> ${escapeHTML(order.customer_email)}<br>
            <strong>Opmerking:</strong> ${escapeHTML(order.notes || "Geen")}
          </div>
        </td>
      </tr>
    </table>
  `;

  const closingCustomer = `
    <p style="margin:16px 0 0 0;">
      Heb je vragen? Reageer dan gerust op deze e-mail of neem contact met ons op.
    </p>
    <p style="margin:16px 0 0 0;">
      Groetjes,<br>
      <strong>${brand.mailName}</strong>
    </p>
  `;

  const closingRestaurant = `
    <p style="margin:16px 0 0 0;">
      Controleer de bestelling en verwerk deze in het beheerscherm.
    </p>
  `;

  const body = `
    ${kind === "customer" ? customerIntro : restaurantIntro}
    ${infoBlock}
    ${orderTable}
    ${kind === "customer" ? closingCustomer : closingRestaurant}
  `;

  return {
    to: kind === "customer"
      ? String(order.customer_email || "").trim()
      : location.order_email,
    subject: kind === "customer"
      ? `Bestelbevestiging #${orderNumberText} – ${brand.mailName}`
      : `Nieuwe bestelling #${orderNumberText} – ${brand.mailName}`,
    html: template(
      kind === "customer" ? "Bedankt voor je bestelling!" : "Nieuwe bestelling ontvangen!",
      body
    ),
  };
}
/* Korte vestigingsnaam voor de onderwerpregel, bijvoorbeeld "Oud-Beijerland". */
const shortName = (l: any) => String(l.name || "").replace(brand.name, "").trim() || l.slug;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond({ error: "Alleen POST toegestaan" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!serviceKey || !url) return respond({ error: "Supabase-configuratie ontbreekt" }, 503);
  if (!await authorizedService(req)) return respond({ error: 'Geen toegang' }, 403);

  let payload: { health?: boolean; order_id?: string; limit?: number };
  try { payload = await req.json(); } catch { return respond({ error: "Ongeldige JSON" }, 400); }
  if (payload.health === true) return respond({ ok: true, resend_configured: !!resendKey, logo_configured: /^https:\/\//i.test(LOGO_URL) });
  if (!resendKey) return respond({ error: "RESEND_API_KEY is niet ingesteld" }, 503);

  const root = createClient(url, serviceKey, { auth: { persistSession: false } });
  const specificOrder = payload.order_id;
  if (specificOrder && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(specificOrder))
    return respond({ error: "Ongeldig order_id" }, 400);

  // Eén geplande uitvoering tegelijk. Herhalen is veilig: de Idempotency-Key hangt aan bestelling + berichttype.
  const limit = Math.max(1, Math.min(20, Number(payload.limit) || 10));
  const locations = await root.from('mtf_locations').select('*').order('created_at'); if (locations.error) return respond({ error: 'Vestigingen niet beschikbaar' }, 500);
  const results: Array<{ id: number; kind: string; status: string; location: string }> = [];
  for (const location of locations.data || []) {
    if (!location.published) continue;
    const supabase = scopedDb(root, location);
    let q = supabase.from("order_email_outbox").select("id,order_id,kind,status,attempts").in("status", ["pending", "failed"]).lt("attempts", 5).order("id", { ascending: true }).limit(limit);
    if (specificOrder) q = q.eq("order_id", specificOrder);
    const { data: jobs, error: jobsError } = await q;
    if (jobsError) return respond({ error: "Wachtrij kon niet worden gelezen" }, 500);

    for (const job of jobs || []) {
      const { data: claimed, error: claimError } = await supabase.from("order_email_outbox")
        .update({ status: "processing", attempts: job.attempts + 1, last_error: null })
        .eq("id", job.id).eq("status", job.status).eq("attempts", job.attempts).select("id").maybeSingle();
      if (claimError || !claimed) continue;
      try {
        const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", job.order_id).single();
        if (orderError || !order) throw new Error("Bestelling kon niet worden geladen");
        const kind = job.kind as "restaurant" | "customer";
        if (kind !== "restaurant" && kind !== "customer") throw new Error("Ongeldig berichttype");
        const mail = message(order, kind, location);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to)) throw new Error("Ongeldig ontvangeradres");
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": location.is_primary ? `mtf-order-${job.order_id}-${kind}` : `mtf-order-${location.slug}-${job.order_id}-${kind}`,
          },
          body: JSON.stringify({ from: location.is_primary ? FROM : String(location.name).replace(/’/g, "'") + " <" + location.order_email + ">", reply_to: location.order_email, to: [mail.to], subject: (location.is_primary ? '' : '[' + shortName(location) + '] ') + mail.subject, html: mail.html }),
        });
        const response = await r.json().catch(() => ({})) as { id?: string; message?: string };
        if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${String(response.message || "onbekend").slice(0, 200)}`);
        const { error: doneError } = await supabase.from("order_email_outbox")
          .update({ status: "sent", resend_id: response.id || null, sent_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
        if (doneError) throw doneError;
        results.push({ id: job.id, kind, status: "sent", location: location.slug });
      } catch (err) {
        await supabase.from("order_email_outbox").update({ status: "failed", last_error: String(err).slice(0, 450) }).eq("id", job.id);
        results.push({ id: job.id, kind: job.kind, status: "failed", location: location.slug });
      }
    }
  }
  return respond({ ok: true, processed: results.length, results });
});
