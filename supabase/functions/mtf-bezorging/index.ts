// Bezorgen bij Mom's Thai Food: bezorgportaal, live locatie en de volgpagina voor klanten.
//
// Drie soorten aanroepen (altijd POST met JSON, veld "actie"):
//  1. Klant, zonder login:   volg            bestelnummer + telefoonnummer -> status en, tijdens het bezorgen, de plek van de bezorger
//  2. Bezorger (eigen login): ik, mijn_bestellingen, start, positie, afgeleverd
//  3. Beheer (eigen login):   bezorgers (recht Bestellingen), toewijzen (recht Bestellingen), bezorger_instellen (recht Gebruikers)
//
// De plek van een bezorger wordt alleen bewaard zolang die een bestelling "Onderweg" heeft,
// en een klant ziet hem alleen voor de eigen bestelling die onderweg is.
// verify_jwt staat uit; deze functie controleert zelf wie er aanklopt.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SCHEMAS: Record<string, string> = { "spijkenisse": "public", "oud-beijerland": "mtf_ob" };
const OPEN = ["Nieuw", "In bereiding", "Klaar", "Onderweg"];
const VERS_MS = 3 * 60000;        // oudere plek tonen we niet meer als "live"
const MAX_MISLUKT = 12;           // mislukte volgpogingen per uur per adres
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Fout extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }
const antwoord = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
// deno-lint-ignore no-explicit-any
async function ok(q: any) { const r = await q; if (r.error) throw r.error; return r.data; }
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const voornaam = (v: unknown) => String(v ?? "").trim().split(/\s+/)[0].slice(0, 40);
// deno-lint-ignore no-explicit-any
const scoped = (root: any, schema: string) => schema === "public" ? root : root.schema(schema);

/* Bestelnummer zoals de klant het kent -> vestiging + volgnummer. */
function leesNummer(invoer: unknown): { slug: string; nummer: number } | null {
  const s = String(invoer ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let m = s.match(/^MTFOB0*(\d{1,9})$/); if (m) return { slug: "oud-beijerland", nummer: Number(m[1]) };
  m = s.match(/^MTF00284(\d{3})$/); if (m && Number(m[1]) >= 1) return { slug: "spijkenisse", nummer: Number(m[1]) };
  m = s.match(/^0*(\d{1,9})$/); if (m && Number(m[1]) >= 1) return { slug: "spijkenisse", nummer: Number(m[1]) };
  return null;
}
function toonNummer(slug: string, n: unknown) {
  const x = Number(n);
  if (slug === "oud-beijerland") return "MTFOB" + String(n).padStart(5, "0");
  return Number.isSafeInteger(x) && x >= 1 && x <= 999 ? "MTF00284" + String(x).padStart(3, "0") : String(n ?? "");
}
/* Telefoonnummers vergelijken op de laatste 9 cijfers: 0612345678, +31612345678 en 06-12345678 zijn gelijk. */
const telefoon = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);

// deno-lint-ignore no-explicit-any
async function volg(root: any, body: any, req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || "onbekend";
  const emmer = "volg:" + ip;
  const limiet = await ok(root.from("mtf_promotion_limits").select("count,started_at").eq("bucket", emmer).maybeSingle());
  if (limiet && Date.now() - Date.parse(limiet.started_at) < 3600000 && limiet.count >= MAX_MISLUKT)
    throw new Fout("Te veel pogingen. Probeer het over een uur opnieuw of bel ons even.", 429);
  const nr = leesNummer(body.nummer), tel = telefoon(body.telefoon);
  // Zelfde melding bij een onbekend nummer en bij een verkeerd telefoonnummer: zo is niet te raden welke bestelnummers bestaan.
  const mis = async () => { await root.rpc("mtf_promotion_rate", { p_bucket: emmer, p_limit: MAX_MISLUKT }); throw new Fout("We vinden geen bestelling met dit bestelnummer en telefoonnummer. Controleer beide en probeer het opnieuw.", 404); };
  if (!nr || tel.length < 9) return await mis();
  const db = scoped(root, SCHEMAS[nr.slug]);
  const o = await ok(db.from("orders").select("id,order_number,status,method,customer_name,phone,address,city,requested_date,requested_time,driver_id,delivery_started_at,created_at").eq("order_number", nr.nummer).maybeSingle());
  if (!o || telefoon(o.phone) !== tel) return await mis();
  // Oude bestellingen zijn niet meer te volgen.
  if (Date.now() - Date.parse(o.created_at) > 14 * 86400000 && !OPEN.includes(o.status)) return await mis();
  // deno-lint-ignore no-explicit-any
  const uit: any = {
    ok: true,
    bestelling: {
      nummer: toonNummer(nr.slug, o.order_number), status: o.status, methode: o.method, naam: voornaam(o.customer_name),
      adres: o.method === "Bezorgen" ? [o.address, o.city].filter(Boolean).join(", ") : null,
      datum: o.requested_date, tijd: String(o.requested_time ?? "").slice(0, 5), gestart: o.delivery_started_at,
    },
    bezorger: null,
  };
  if (o.method === "Bezorgen" && o.status === "Onderweg" && o.driver_id) {
    const [staf, plek] = await Promise.all([
      ok(db.from("mtf_staff").select("name").eq("user_id", o.driver_id).maybeSingle()),
      ok(db.from("mtf_driver_positions").select("lat,lng,updated_at").eq("user_id", o.driver_id).maybeSingle()),
    ]);
    const vers = !!plek && Date.now() - Date.parse(plek.updated_at) < VERS_MS;
    uit.bezorger = { naam: voornaam(staf?.name) || "Je bezorger", lat: vers ? plek.lat : null, lng: vers ? plek.lng : null, bijgewerkt: vers ? plek.updated_at : null };
  }
  return uit;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return antwoord(405, { fout: "Niet toegestaan" });
  const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // deno-lint-ignore no-explicit-any
    let body: any;
    try { body = await req.json(); } catch { throw new Fout("Ongeldig verzoek"); }
    const actie = String(body?.actie ?? "");
    if (actie === "volg") return antwoord(200, await volg(root, body, req));

    /* ---------- Vanaf hier: ingelogde medewerkers ---------- */
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Fout("Log in om verder te gaan.", 401);
    const { data: u, error: ue } = await root.auth.getUser(token);
    if (ue || !u?.user) throw new Fout("Sessie verlopen. Log opnieuw in.", 401);
    const uid = u.user.id;
    // Lidmaatschap per vestiging; de eigenaar (Spijkenisse) mag overal bij.
    const leden: Record<string, any> = {}; // deno-lint-ignore-line no-explicit-any
    for (const [slug, schema] of Object.entries(SCHEMAS)) leden[slug] = await ok(scoped(root, schema).from("mtf_staff").select("*").eq("user_id", uid).maybeSingle());
    const eigenaar = !!(leden["spijkenisse"]?.owner && leden["spijkenisse"]?.active);
    const toegestaan = Object.keys(SCHEMAS).filter((s) => eigenaar || leden[s]?.active);
    if (!toegestaan.length) throw new Fout("Dit account heeft geen toegang.", 403);
    let slug = typeof body.location === "string" && toegestaan.includes(body.location) ? body.location : "";
    // Zonder keuze: de vestiging waar deze persoon bezorger is, anders de eerste waar die bij mag.
    if (!slug) slug = toegestaan.find((s) => leden[s]?.driver) || toegestaan[0];
    const db = scoped(root, SCHEMAS[slug]);
    const ik = leden[slug] || leden["spijkenisse"];
    const mag = (recht: string) => eigenaar || !!ik?.permissions?.[recht];
    const bezorger = eigenaar || !!leden[slug]?.driver;
    const nummer = (o: { order_number: unknown }) => toonNummer(slug, o.order_number);

    if (actie === "ik")
      return antwoord(200, { ok: true, naam: ik?.name || ik?.email || "", bezorger, beheer: mag("orders"), vestiging: slug, vestigingen: toegestaan.filter((s) => eigenaar || leden[s]?.driver) });

    /* ---------- Beheer ---------- */
    if (actie === "bezorgers") {
      if (!mag("orders")) throw new Fout("Geen rechten voor dit onderdeel", 403);
      const [staf, plekken, onderweg] = await Promise.all([
        ok(db.from("mtf_staff").select("user_id,name,email").eq("driver", true).eq("active", true).order("name")),
        ok(db.from("mtf_driver_positions").select("*")),
        ok(db.from("orders").select("driver_id").eq("status", "Onderweg").not("driver_id", "is", null)),
      ]);
      // deno-lint-ignore no-explicit-any
      return antwoord(200, { ok: true, bezorgers: staf.map((s: any) => {
        // deno-lint-ignore no-explicit-any
        const p = plekken.find((x: any) => x.user_id === s.user_id), vers = !!p && Date.now() - Date.parse(p.updated_at) < VERS_MS;
        // deno-lint-ignore no-explicit-any
        return { id: s.user_id, naam: s.name || s.email, onderweg: onderweg.filter((x: any) => x.driver_id === s.user_id).length, lat: vers ? p.lat : null, lng: vers ? p.lng : null, bijgewerkt: p?.updated_at ?? null };
      }) });
    }
    if (actie === "toewijzen") {
      if (!mag("orders")) throw new Fout("Geen rechten voor dit onderdeel", 403);
      if (!uuid(body.id)) throw new Fout("Bestelling ontbreekt");
      const naar = body.bezorger === null || body.bezorger === "" ? null : body.bezorger;
      if (naar !== null) {
        if (!uuid(naar)) throw new Fout("Onbekende bezorger");
        const s = await ok(db.from("mtf_staff").select("user_id").eq("user_id", naar).eq("driver", true).eq("active", true).maybeSingle());
        if (!s) throw new Fout("Deze medewerker is geen actieve bezorger");
      }
      const o = await ok(db.from("orders").select("id,method,status").eq("id", body.id).maybeSingle());
      if (!o) throw new Fout("Bestelling niet gevonden");
      if (o.method !== "Bezorgen") throw new Fout("Alleen bezorgbestellingen kunnen worden toegewezen");
      if (!OPEN.includes(o.status)) throw new Fout("Deze bestelling is al afgerond");
      await ok(db.from("orders").update({ driver_id: naar }).eq("id", o.id));
      return antwoord(200, { ok: true, driver_id: naar });
    }
    if (actie === "bezorger_instellen") {
      if (!mag("users")) throw new Fout("Geen rechten voor dit onderdeel", 403);
      if (!uuid(body.id) || typeof body.bezorger !== "boolean") throw new Fout("Ongeldig verzoek");
      const s = await ok(db.from("mtf_staff").update({ driver: body.bezorger }).eq("user_id", body.id).select("user_id").maybeSingle());
      if (!s) throw new Fout("Account niet gevonden");
      if (!body.bezorger) await ok(db.from("mtf_driver_positions").delete().eq("user_id", body.id));
      return antwoord(200, { ok: true });
    }

    /* ---------- Bezorger ---------- */
    if (!bezorger) throw new Fout("Dit account is geen bezorger. Vraag de eigenaar om je als bezorger aan te merken.", 403);
    const mijnOnderweg = async () => (await ok(db.from("orders").select("id").eq("driver_id", uid).eq("status", "Onderweg"))).length;

    if (actie === "mijn_bestellingen") {
      const rows = await ok(db.from("orders").select("id,order_number,status,customer_name,phone,address,city,requested_date,requested_time,payment,payment_status,items,notes,total,delivery_fee,delivery_started_at")
        .eq("driver_id", uid).eq("method", "Bezorgen").in("status", OPEN).order("requested_date").order("requested_time"));
      const vandaag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date());
      const klaar = await ok(db.from("orders").select("id", { count: "exact", head: false }).eq("driver_id", uid).eq("status", "Bezorgd").eq("requested_date", vandaag));
      // deno-lint-ignore no-explicit-any
      return antwoord(200, { ok: true, bestellingen: rows.map((o: any) => ({ ...o, nummer: nummer(o) })), bezorgd_vandaag: klaar.length });
    }
    if (actie === "start") {
      // Eén bestelling (id) of alle toegewezen bestellingen die nog niet onderweg zijn.
      let q = db.from("orders").select("id").eq("driver_id", uid).eq("method", "Bezorgen").in("status", ["Nieuw", "In bereiding", "Klaar"]);
      if (body.id !== undefined) { if (!uuid(body.id)) throw new Fout("Bestelling ontbreekt"); q = q.eq("id", body.id); }
      const rows = await ok(q);
      if (!rows.length) throw new Fout("Geen bestelling om te starten");
      for (const r of rows) {
        await ok(db.rpc("mtf_finish_order", { p_id: r.id, p_status: "Onderweg", p_folder: null, p_actor: uid }));
        await ok(db.from("orders").update({ delivery_started_at: new Date().toISOString() }).eq("id", r.id));
      }
      return antwoord(200, { ok: true, gestart: rows.length });
    }
    if (actie === "positie") {
      const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.nauwkeurigheid);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Fout("Ongeldige locatie");
      // Alleen bewaren tijdens een bezorging.
      if (!(await mijnOnderweg())) { await ok(db.from("mtf_driver_positions").delete().eq("user_id", uid)); return antwoord(200, { ok: true, delen: false }); }
      await ok(db.from("mtf_driver_positions").upsert({ user_id: uid, lat, lng, accuracy: Number.isFinite(acc) ? Math.min(acc, 100000) : null, updated_at: new Date().toISOString() }));
      return antwoord(200, { ok: true, delen: true });
    }
    if (actie === "afgeleverd") {
      if (!uuid(body.id)) throw new Fout("Bestelling ontbreekt");
      const o = await ok(db.from("orders").select("id,status").eq("id", body.id).eq("driver_id", uid).maybeSingle());
      if (!o) throw new Fout("Deze bestelling is niet aan jou toegewezen");
      if (o.status !== "Onderweg") throw new Fout("Start eerst de bezorging van deze bestelling");
      await ok(db.rpc("mtf_finish_order", { p_id: o.id, p_status: "Bezorgd", p_folder: null, p_actor: uid }));
      const rest = await mijnOnderweg();
      if (!rest) await ok(db.from("mtf_driver_positions").delete().eq("user_id", uid));
      return antwoord(200, { ok: true, nog_onderweg: rest });
    }
    throw new Fout("Onbekende actie");
  } catch (e) {
    if (e instanceof Fout) return antwoord(e.status, { fout: e.message });
    console.error("mtf-bezorging", e);
    return antwoord(500, { fout: "Er ging iets mis. Probeer het opnieuw." });
  }
});
