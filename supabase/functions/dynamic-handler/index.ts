import { scopedDb, authorizedService } from "./locations.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Mom's Thai Food: secured, manually/periodically invoked order-email worker.
// Secrets live in Supabase Edge Function Secrets, never in this source file.
// Deploy with JWT verification ON. Invoke with service_role Bearer token only.
// RESEND_INBOUND_DOMAIN (optioneel): ontvangstdomein van Resend Inbound. Indien gezet krijgt de
// restaurantmail van Tikkie-orders een antwoordadres betaallink-<code>@domein (zie payment-link-inbound).
// Berichttype 'preparing': klantmail zodra een bezorgbestelling op 'In bereiding' komt
// (wachtrij gevuld door trigger mtf_preparing_mail op orders). Bevat de link naar de volgpagina (/volg).
// Voorbeeldmail daarvan: POST {"preview_to":"adres"} (alleen met servicesleutel).

const FROM = "Mom's Thai Food <bestellingen@mail.momsthaifood.nl>";
const RESTAURANT_EMAIL = "info@momsthaifood.nl";
const WEBSITE = "https://bestellen.momsthaifood.nl";
const LOGO_URL = "https://uywydquzvdbpfjjrwsbt.supabase.co/storage/v1/object/public/logo/MTF_portret_logo_email.png"; // Optional, public HTTPS transparent PNG URL.
const PREPARING_MAX_AGE_MS = 30 * 60000; // daarna is de melding niet meer actueel
const encoder = new TextEncoder();
const respond = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const escapeHTML = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
const money = (value: unknown) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(value) || 0);

function template(title: string, body: string) {
  const logo = /^https:\/\//i.test(LOGO_URL) ? `<img src="${escapeHTML(LOGO_URL)}" alt="Mom\'s Thai Food" width="110" style="display:block;max-width:110px;height:auto;margin:0 auto 12px;border:0">` : "";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,Helvetica,sans-serif;color:#262222">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f0e8"><tr><td align="center" style="padding:20px 8px"><table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#fffaf4;border-collapse:collapse">
<tr><td align="center" style="background:#9d0e0d;padding:30px 20px 25px;border-bottom:7px solid #f3c35a">${logo}<div style="font:bold 30px Georgia,serif;color:#fff;letter-spacing:1px;line-height:1.1">MOM\'S</div><div style="font:bold 25px Georgia,serif;color:#fff;letter-spacing:1px;line-height:1.3">THAI FOOD</div><div style="font:italic 20px Georgia,serif;color:#ffd56c;margin-top:9px">Thais eten bij jou thuis!</div></td></tr>
<tr><td style="padding:30px 26px;background:#fffaf4"><h1 style="margin:0 0 18px;text-align:center;font:bold 29px Georgia,serif;color:#a00d09">${escapeHTML(title)}</h1><div style="font-size:15px;line-height:1.65;color:#262222">${body}</div></td></tr>
<tr><td align="center" style="background:#9d0e0d;border-top:7px solid #f3c35a;padding:20px"><div style="font:italic 17px Georgia,serif;color:#ffd56c;margin-bottom:8px">Thais eten bij jou thuis!</div><a href="${WEBSITE}" style="color:#fff;font-size:13px">Bestellen bij Mom\'s Thai Food</a></td></tr>
</table></td></tr></table></body></html>`;
}
function displayOrderNumber(value: unknown): string {
 const n = Number(value);
 return Number.isSafeInteger(n) && n >= 1 && n <= 999 ? "MTF00284" + String(n).padStart(3, "0") : String(value ?? "");
}
function preparingMessage(order: Record<string, unknown>, orderNumber: string, location: any) {
  // Volgpagina: het bestelnummer staat al ingevuld; de klant vult zelf het telefoonnummer van de bestelling in.
  const trackUrl = `${WEBSITE}/volg?b=${encodeURIComponent(orderNumber)}`;
  const body = `
    <p style="margin:0 0 14px 0;">Hoi ${escapeHTML(order.customer_name)},</p>
    <p style="margin:0 0 14px 0;">Goed nieuws: we zijn begonnen met het bereiden van je bestelling!</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 22px 0;background:#fff6e8;border:1px solid #efd8a8;border-radius:12px;">
      <tr><td style="padding:18px;font-size:16px;line-height:1.7;color:#2f2f2f;text-align:center;">
        Je bestelling is over ongeveer <strong>30 tot 50 minuten</strong> bij je.<br>
        <span style="font-size:13px;color:#6b6262;">Bestelnummer ${escapeHTML(orderNumber)} · Bezorgen op ${escapeHTML(order.address)}, ${escapeHTML(order.city)}</span>
      </td></tr>
    </table>
    <p style="margin:0 0 10px 0;text-align:center;"><a href="${escapeHTML(trackUrl)}" style="background:#940c0d;color:#fff;padding:14px 24px;display:inline-block;border-radius:8px;text-decoration:none;font-weight:bold;">Volg je bestelling</a></p>
    <p style="margin:0 0 18px 0;text-align:center;font-size:13px;line-height:1.6;color:#6b6262;">Vul je bestelnummer (${escapeHTML(orderNumber)}) en het telefoonnummer van je bestelling in.<br>Zodra de bezorger vertrekt, zie je live op de kaart waar die is.</p>
    <p style="margin:16px 0 0 0;">Heb je vragen? Reageer dan gerust op deze e-mail of neem contact met ons op.</p>
    <p style="margin:16px 0 0 0;">Alvast eet smakelijk!<br><strong>Mom's Thai Food</strong></p>
  `;
  return {
    to: String(order.customer_email || "").trim(),
    replyTo: location.order_email,
    subject: `Je bestelling #${orderNumber} wordt bereid – Mom's Thai Food`,
    html: template("Je bestelling wordt bereid!", body),
  };
}
function message(order: Record<string, unknown>, kind: "restaurant" | "customer" | "preparing", location:any, inbound = "") {
  const orderNumber=location.slug==='oud-beijerland'?'MTFOB'+String(order.order_number).padStart(5,'0'):displayOrderNumber(order.order_number);
  if (kind === "preparing") return preparingMessage(order, orderNumber, location);
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

  const payInbound = kind === "restaurant" && !!inbound && /betaalverzoek/i.test(String(order.payment ?? "")) && typeof order.payment_link_token === "string" && /^[a-f0-9]{32}/.test(String(order.payment_link_token));
  const replyTo = payInbound ? `betaallink-${String(order.payment_link_token).slice(0, 32)}@${inbound}` : location.order_email;
  const adminUrl = "https://bestellen.momsthaifood.nl/admin.html?location=" + encodeURIComponent(location.slug || "spijkenisse");
  const payBlock = payInbound ? `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 22px 0;background:#fff1f0;border:2px solid #940c0d;border-radius:12px;">
      <tr>
        <td style="padding:18px;">
          <div style="font-family:Georgia,serif;font-size:20px;color:#8b090c;font-weight:bold;margin-bottom:10px;">
            Betaallink nodig
          </div>
          <div style="font-size:15px;line-height:1.7;color:#2f2f2f;">
            Deze klant betaalt met <strong>Betaalverzoek / Tikkie</strong> (${money(order.total)}).<br>
            <strong>Beantwoord deze mail met alleen de betaallink</strong> (bijvoorbeeld https://tikkie.me/pay/...).
            De link wordt dan automatisch aan de bestelling gekoppeld en naar de klant gemaild. Je krijgt een bevestiging terug.
          </div>
          <p style="margin:14px 0 0 0;"><a href="${escapeHTML(adminUrl)}" style="background:#940c0d;color:#fff;padding:12px 18px;display:inline-block;border-radius:8px;text-decoration:none;">Of vul de link in via het beheerscherm</a></p>
        </td>
      </tr>
    </table>
  ` : "";

  const infoBlock = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 22px 0;background:#fff6e8;border:1px solid #efd8a8;border-radius:12px;">
      <tr>
        <td style="padding:18px 18px 12px 18px;">
          <div style="font-family:Georgia,serif;font-size:20px;color:#8b090c;font-weight:bold;margin-bottom:10px;">
            Bestelgegevens
          </div>
          <div style="font-size:15px;line-height:1.8;color:#2f2f2f;">
            <strong>Bestelnummer:</strong> ${escapeHTML(orderNumber)}<br>
            <strong>Bestelwijze:</strong> ${escapeHTML(order.method)}<br>
            <strong>Datum:</strong> ${escapeHTML(order.requested_date)}<br>
            <strong>Tijd:</strong> ${escapeHTML(String(order.requested_time ?? "").slice(0, 5))}<br>
            <strong>${pickup ? "Afhalen" : "Bezorgadres"}:</strong>
            ${pickup ? (location.slug==='oud-beijerland'?escapeHTML(location.address):"Op locatie") : `${escapeHTML(order.address)}, ${escapeHTML(order.city)}`}<br>
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
      Bedankt voor je bestelling bij <strong>Mom's Thai Food</strong>!  
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
    ${payBlock}
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
      <strong>Mom's Thai Food</strong>
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
    replyTo: kind === "customer" ? location.order_email : replyTo,
    subject: kind === "customer"
      ? `Bestelbevestiging #${orderNumber} – Mom's Thai Food`
      : `${payInbound ? "Betaallink nodig – " : ""}Nieuwe bestelling #${orderNumber} – Mom's Thai Food`,
    html: template(
      kind === "customer" ? "Bedankt voor je bestelling!" : "Nieuwe bestelling ontvangen!",
      body
    ),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond({ error: "Alleen POST toegestaan" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!serviceKey || !url) return respond({ error: "Supabase-configuratie ontbreekt" }, 503);

  // Defense in depth; in Supabase, enable Verify JWT when deploying.
  
const supplied=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
if(!await authorizedService(req))return respond({error:'Geen toegang'},403);

  let payload: { health?: boolean; order_id?: string; limit?: number; preview_to?: string };
  try { payload = await req.json(); } catch { return respond({ error: "Ongeldige JSON" }, 400); }
  const inboundRaw = (Deno.env.get("RESEND_INBOUND_DOMAIN") || "").trim().toLowerCase().replace(/^.*@/, "");
  const inbound = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(inboundRaw) ? inboundRaw : "";
  if (payload.health === true) return respond({ ok: true, resend_configured: !!resendKey, logo_configured: /^https:\/\//i.test(LOGO_URL), payment_inbound_configured: !!inbound });
  if (!resendKey) return respond({ error: "RESEND_API_KEY is niet ingesteld" }, 503);

  if (payload.preview_to) {
    const to = String(payload.preview_to).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return respond({ error: "Ongeldig adres" }, 400);
    const sample = { order_number: 34, customer_name: "Sanne", customer_email: to, method: "Bezorgen", address: "Voorbeeldstraat 12", city: "Spijkenisse" };
    const mail = message(sample, "preparing", { slug: "spijkenisse", order_email: RESTAURANT_EMAIL });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": "mtf-preparing-preview-" + crypto.randomUUID() },
      body: JSON.stringify({ from: FROM, reply_to: mail.replyTo, to: [to], subject: "[Voorbeeld] " + mail.subject, html: mail.html }),
    });
    const response = await r.json().catch(() => ({})) as { id?: string; message?: string };
    if (!r.ok) return respond({ error: `Resend HTTP ${r.status}: ${String(response.message || "onbekend").slice(0, 200)}` }, 502);
    return respond({ ok: true, preview: response.id || true });
  }

  const root = createClient(url, serviceKey, { auth: { persistSession: false } });
  const specificOrder = payload.order_id;
  if (specificOrder && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(specificOrder))
    return respond({ error: "Ongeldig order_id" }, 400);

  // To avoid overlapping workers, configure only ONE scheduled execution at a time.
  // Retry idempotency is anchored to order + message type.
  const limit = Math.max(1, Math.min(20, Number(payload.limit) || 10));
  const locations=await root.from('mtf_locations').select('*').order('created_at');if(locations.error)return respond({error:'Vestigingen niet beschikbaar'},500);
  const results: Array<{ id: number; kind: string; status: string;location:string }> = [];
  for(const location of locations.data||[]){if(!location.published)continue;const supabase=scopedDb(root,location);
  let q = supabase.from("order_email_outbox").select("id,order_id,kind,status,attempts,created_at").in("status", ["pending", "failed"]).lt("attempts", 5).order("id", { ascending: true }).limit(limit);
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
      const kind = job.kind as "restaurant" | "customer" | "preparing";
      if (kind !== "restaurant" && kind !== "customer" && kind !== "preparing") throw new Error("Ongeldig berichttype");
      if (kind === "preparing") {
        const tooLate = Date.now() - new Date(job.created_at).getTime() > PREPARING_MAX_AGE_MS;
        if (order.status !== "In bereiding" || order.method !== "Bezorgen" || tooLate) {
          // Niet meer actueel: definitief afsluiten zodat er niet opnieuw wordt geprobeerd.
          await supabase.from("order_email_outbox").update({ status: "failed", attempts: 5, last_error: "Niet verstuurd: status gewijzigd, geen bezorging of te laat" }).eq("id", job.id);
          results.push({ id: job.id, kind, status: "skipped", location: location.slug });
          continue;
        }
      }
      const mail = message(order, kind,location,inbound);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to)) throw new Error("Ongeldig ontvangeradres");
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": location.slug==='spijkenisse'?`mtf-order-${job.order_id}-${kind}`:`mtf-order-${location.slug}-${job.order_id}-${kind}`,
        },
        body: JSON.stringify({ from: location.slug==='oud-beijerland'?"Mom's Thai Food Oud-Beijerland <"+location.order_email+">":FROM,reply_to:mail.replyTo,to: [mail.to], subject: (location.slug==='oud-beijerland'?'[Oud-Beijerland] ':'')+mail.subject, html: mail.html }),
      });
      const response = await r.json().catch(() => ({})) as { id?: string; message?: string };
      if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${String(response.message || "onbekend").slice(0, 200)}`);
      const { error: doneError } = await supabase.from("order_email_outbox")
        .update({ status: "sent", resend_id: response.id || null, sent_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      if (doneError) throw doneError;
      results.push({ id: job.id, kind, status: "sent",location:location.slug });
    } catch (err) {
      await supabase.from("order_email_outbox").update({ status: "failed", last_error: String(err).slice(0, 450) }).eq("id", job.id);
      results.push({ id: job.id, kind: job.kind, status: "failed",location:location.slug });
    }
  }
  }
  return respond({ ok: true, processed: results.length, results });
});
