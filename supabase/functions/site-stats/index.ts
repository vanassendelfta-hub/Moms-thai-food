import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ownHost } from "./brand.ts";

/* Websitestatistieken zonder cookies. Er wordt geen IP-adres opgeslagen: alleen een
   anonieme code (hash van IP + browser + maand + geheim) die elke maand verandert. */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch/i;

/* Vestigingen uit de database, één minuut bewaard zodat niet elk paginabezoek een extra query kost. */
let cache: { at: number; slugs: string[]; primary: string } | null = null;
async function locations(db: any) {
  if (cache && Date.now() - cache.at < 60000) return cache;
  const { data, error } = await db.from("mtf_locations").select("slug,is_primary");
  if (error) throw error;
  cache = { at: Date.now(), slugs: (data || []).map((l: any) => l.slug), primary: (data || []).find((l: any) => l.is_primary)?.slug || "" };
  return cache;
}

function amsterdamDate(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (date: string, n: number) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDate = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x + "T12:00:00Z"));

async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request, location: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("authorization");
  const key = req.headers.get("x-admin-key");
  if (auth) headers.Authorization = auth;
  else if (key) headers["x-admin-key"] = key;
  else return false;
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/admin-api", { method: "POST", headers, body: JSON.stringify({ action: "whoami", location }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) return false;
  const d = await r.json().catch(() => null);
  const a = d?.actor;
  return !!(a && (a.owner || a.global_owner || a.legacy || a.permissions?.finance));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 2000) return json({ ok: false }, 413);
    const body = JSON.parse(raw || "{}");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const known = await locations(db);
    const location = known.slugs.includes(body.location) ? body.location : known.primary;

    if (body.action === "hit") {
      const ua = req.headers.get("user-agent") || "";
      if (!ua || BOT.test(ua)) return json({ ok: true, skipped: true });
      let path = String(body.path || "/").split("?")[0].split("#")[0].slice(0, 200) || "/";
      if (!path.startsWith("/")) path = "/";
      path = path.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
      if (/^\/admin/.test(path)) return json({ ok: true, skipped: true });
      let referrer: string | null = null;
      try { const h = new URL(String(body.ref || "")).hostname.replace(/^www\./, ""); if (h && !ownHost(h)) referrer = h.slice(0, 200); } catch { /* geen verwijzer */ }
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "onbekend";
      const today = amsterdamDate();
      const visitor = await sha256([ip, ua, today.slice(0, 7), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")].join("|"));
      const { error } = await db.from("mtf_pageviews").insert({ day: today, path, visitor, referrer_host: referrer, location });
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "report") {
      if (!(await authorized(req, location))) return json({ ok: false, error: "Geen toegang tot statistieken" }, 403);
      const today = amsterdamDate();
      const unit = ["hour", "day", "week", "month"].includes(body.unit) ? body.unit : "day";
      const weekStart = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
      const monthStart = today.slice(0, 8) + "01";
      const run = (f: string, t: string, u: string) => db.rpc("mtf_site_report", { p_from: f, p_to: t, p_unit: u });
      let from: string, to: string;
      if (unit === "hour") {
        from = to = validDate(body.day) && body.day <= today ? body.day : today;
      } else {
        const span = unit === "day" ? 29 : unit === "week" ? 7 * 11 + ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) : 0;
        from = validDate(body.from) ? body.from : addDays(today, -span);
        if (unit === "month" && !validDate(body.from)) { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 11); from = d.toISOString().slice(0, 10); }
        to = validDate(body.to) ? body.to : today;
      }
      if (from > to) throw Error("De begindatum ligt na de einddatum.");
      const [main, d, w, m, hourly] = await Promise.all([
        run(from, to, unit === "hour" ? "day" : unit), run(today, today, "day"), run(weekStart, today, "week"), run(monthStart, today, "month"),
        unit === "hour" ? db.rpc("mtf_site_hourly", { p_day: from }) : Promise.resolve({ data: null, error: null }),
      ]);
      for (const r of [main, d, w, m, hourly]) if (r.error) throw r.error;
      const out: Record<string, unknown> = { ok: true, unit, from, to, today, ...main.data, kpis: { today: d.data.totals, week: w.data.totals, month: m.data.totals } };
      if (unit === "hour") out.series = hourly.data;
      return json(out);
    }

    return json({ ok: false, error: "Onbekende actie" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Onbekende fout" }, 400);
  }
});
