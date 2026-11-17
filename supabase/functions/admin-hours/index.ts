// Beheer van openingstijden per weekdag (fase 1b).
// Zelfde inlog en rechten als het beheerportaal: persoonlijk account, eigenaar of recht 'shop'.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { selectAdminLocation, checked } from "./locations.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:00)?$/;
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Log in met je persoonlijke account om openingstijden te beheren." }, 401);
    const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: auth, error: authError } = await root.auth.getUser(token);
    if (authError || !auth?.user) return json({ error: "Sessie verlopen. Log opnieuw in." }, 401);
    const body = await req.json();
    const { db, actor } = await selectAdminLocation(root, body, auth.user);
    if (!(actor.owner || actor.permissions?.shop)) return json({ error: "Geen recht om openingstijden te wijzigen." }, 403);

    if (body.action === "hours_get") {
      const rows = await checked(db.from("mtf_opening_hours").select("weekday,open_time,close_time,order_cutoff").order("weekday"));
      return json({ ok: true, hours: rows, location: actor.location });
    }

    if (body.action === "hours_save") {
      if (!Array.isArray(body.hours) || body.hours.length > 7) throw Error("Ongeldige openingstijden");
      const seen = new Set<number>();
      const rows = body.hours.map((r: any) => {
        const weekday = Number(r?.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) throw Error("Ongeldige weekdag");
        seen.add(weekday);
        for (const k of ["open_time", "close_time", "order_cutoff"]) if (!TIME.test(String(r?.[k] ?? ""))) throw Error("Vul alle tijden in als uu:mm");
        const o = minutes(r.open_time), c = minutes(r.close_time), cut = minutes(r.order_cutoff);
        if (o % 15 || c % 15) throw Error("Openings- en sluitingstijd moeten op een kwartier vallen");
        if (o >= c) throw Error("Sluitingstijd moet na de openingstijd liggen");
        if (cut > c) throw Error("De uiterste besteltijd mag niet na sluitingstijd liggen");
        return { weekday, open_time: r.open_time.slice(0, 5), close_time: r.close_time.slice(0, 5), order_cutoff: r.order_cutoff.slice(0, 5), updated_at: new Date().toISOString() };
      });
      if (rows.length) await checked(db.from("mtf_opening_hours").upsert(rows, { onConflict: "weekday" }));
      const keep = rows.map((r: any) => r.weekday);
      let del = db.from("mtf_opening_hours").delete();
      del = keep.length ? del.not("weekday", "in", `(${keep.join(",")})`) : del.gte("weekday", 0);
      await checked(del);
      const saved = await checked(db.from("mtf_opening_hours").select("weekday,open_time,close_time,order_cutoff").order("weekday"));
      return json({ ok: true, hours: saved });
    }

    throw Error("Onbekende actie");
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as any)?.message;
    if (!(e instanceof Error)) console.error("admin-hours", JSON.stringify(e));
    return json({ error: msg || "Onbekende fout" }, 400);
  }
});
