import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { render } from "./render.ts";
import { authorizedService, orderNumber } from "./locations.ts";
import { brand } from "./brand.ts";

// Stuurt 1 uur na 'Bezorgd'/'Afgehaald' een bedankmail met reviewverzoek.
// Wachtrij: public.mtf_review_mails (gevuld door trigger op orders).
// Voorbeeldmail: POST {"preview_to":"adres","preview_name":"Naam"} (alleen met servicesleutel).
const SCHEMA_RE = /^(public|mtf_[a-z0-9_]{1,40})$/;
const REPEAT_DAYS = 30; // zelfde klant hooguit 1x per 30 dagen vragen
const FROM = brand.mailName + " <" + brand.mailFrom + ">";
const json = (x: any, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });

function firstName(n: string) { const f = String(n || '').trim().split(/\s+/)[0]; return f ? f.charAt(0).toUpperCase() + f.slice(1) : ''; }
const replyOf = (loc: any) => loc?.mailbox_ready ? loc.order_email : brand.replyTo;

async function send(resendKey: string, idem: string, to: string, replyTo: string, m: { subject: string, html: string, text: string }) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify({ from: FROM, to: [to], reply_to: replyTo, subject: m.subject, text: m.text, html: m.html }) });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) throw Error('E-mailservice gaf fout ' + r.status + ' ' + JSON.stringify(res).slice(0, 200));
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST verplicht' }, 405);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !await authorizedService(req)) return json({ error: 'Geen toegang' }, 403);
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'E-mailservice ontbreekt' }, 500);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, key);
  const now = new Date();
  const body = await req.json().catch(() => ({}));
  const locs = await db.from('mtf_locations').select('*');
  if (locs.error) return json({ error: 'Vestigingen niet beschikbaar' }, 500);

  if (body.preview_to) {
    const to = String(body.preview_to).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'Ongeldig adres' }, 400);
    const loc = (locs.data || []).find((l: any) => l.is_primary);
    const m = render(firstName(body.preview_name || ''), String(loc?.review_url || '').trim(), replyOf(loc), String(body.preview_order || ''));
    m.subject = '[Voorbeeld] ' + m.subject;
    try { const res = await send(resendKey, 'mtf-review-preview-' + crypto.randomUUID(), to, replyOf(loc), m); return json({ ok: true, preview: res.id || true }); }
    catch (e) { return json({ error: String(e) }, 502); }
  }

  await db.from('mtf_review_mails').update({ status: 'failed', last_error: 'Verwerking onderbroken' }).eq('status', 'processing').lt('started_at', new Date(now.getTime() - 5 * 60000).toISOString());
  await db.from('mtf_review_mails').update({ status: 'cancelled', last_error: 'Verlopen' }).in('status', ['pending', 'failed']).lt('send_after', new Date(now.getTime() - 23 * 3600000).toISOString());
  const due = await db.from('mtf_review_mails').select('*').in('status', ['pending', 'failed']).lt('attempts', 5).lte('send_after', now.toISOString()).order('send_after').limit(20);
  if (due.error) return json({ error: 'Wachtrij niet beschikbaar' }, 500);

  const results: any[] = [];
  for (const job of due.data || []) {
    const claim = await db.from('mtf_review_mails').update({ status: 'processing', started_at: new Date().toISOString(), attempts: job.attempts + 1 }).eq('id', job.id).eq('status', job.status).eq('attempts', job.attempts).select('id').maybeSingle();
    if (claim.error || !claim.data) continue;
    const cancel = async (why: string) => { await db.from('mtf_review_mails').update({ status: 'cancelled', last_error: why }).eq('id', job.id); results.push({ id: job.id, status: 'cancelled', why }); };
    try {
      const loc = (locs.data || []).find((l: any) => l.slug === job.location_slug);
      if (!loc || !SCHEMA_RE.test(loc.schema_name)) { await cancel('Onbekende vestiging'); continue; }
      if (!loc.is_primary && !loc.published) { await cancel('Vestiging nog niet vrijgegeven'); continue; }
      const sdb = loc.schema_name === 'public' ? db : db.schema(loc.schema_name);
      const o = await sdb.from('orders').select('status,customer_email,customer_name,order_number').eq('id', job.order_id).maybeSingle();
      if (o.error) throw o.error;
      if (!o.data || !['Bezorgd', 'Afgehaald'].includes(o.data.status)) { await cancel('Bestelling niet (meer) bezorgd/afgehaald'); continue; }
      if (String(o.data.customer_email || '').toLowerCase() !== job.to_email.toLowerCase()) { await cancel('E-mailadres gewijzigd'); continue; }
      const recent = await db.from('mtf_review_mails').select('id').eq('status', 'sent').ilike('to_email', job.to_email.replace(/[%_\\]/g, m => '\\' + m)).gte('sent_at', new Date(now.getTime() - REPEAT_DAYS * 86400000).toISOString()).limit(1);
      if (recent.error) throw recent.error;
      if ((recent.data || []).length) { await cancel('Klant kreeg recent al een reviewverzoek'); continue; }
      const no = Number.isFinite(Number(o.data.order_number)) ? orderNumber(loc, Number(o.data.order_number)) : '';
      const m = render(firstName(o.data.customer_name || job.name), String(loc.review_url || '').trim(), replyOf(loc), no);
      const res = await send(resendKey, `mtf-review-${job.id}`, job.to_email, replyOf(loc), m);
      await db.from('mtf_review_mails').update({ status: 'sent', resend_id: res.id || null, sent_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
      results.push({ id: job.id, status: 'sent' });
    } catch (e) {
      await db.from('mtf_review_mails').update({ status: 'failed', last_error: String(e).slice(0, 300) }).eq('id', job.id);
      results.push({ id: job.id, status: 'failed' });
    }
  }
  return json({ ok: true, results });
});
