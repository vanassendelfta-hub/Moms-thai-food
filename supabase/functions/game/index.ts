import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { brand } from "./brand.ts";

// Spel (module 'game'): scores, ranglijst, scoremail en optionele nieuwsbriefinschrijving. Hoort bij de hoofdvestiging.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers });
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((x) => x.toString(16).padStart(2, "0")).join("");
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const nl = (n: number) => new Intl.NumberFormat("nl-NL").format(n);
const shortName = (n: string) => {
  const p = String(n || "").trim().split(/\s+/);
  return (p[0] || "Speler").slice(0, 20) + (p[1] ? " " + p[1][0].toUpperCase() + "." : "");
};
const FROM = brand.mailName + " <" + brand.mailFrom + ">";
const SITE = brand.siteUrl;
const B = brand.name;

async function checked(q: any) { const r = await q; if (r.error) throw r.error; return r.data; }

async function sendMail(key: string, to: string, subject: string, text: string, inner: string, idem: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": idem },
    body: JSON.stringify({
      from: FROM, to: [to], reply_to: brand.replyTo, subject, text,
      html: `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(subject)}</title></head><body style="background:#fffaf4;color:#262222;font-family:Arial;padding:24px;line-height:1.6"><h1 style="color:${brand.color}">${B}</h1>${inner}<p style="color:#777;font-size:13px">${B} · ${brand.place} · <a href="${SITE}/contact">Contact</a> · <a href="${SITE}/privacy">Privacy</a></p></body></html>`,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error("E-mailservice gaf fout " + r.status);
  return d.id as string;
}

async function staff(root: any, req: Request) {
  const legacyKey = req.headers.get("x-admin-key") || "";
  if (legacyKey && !req.headers.get("authorization")) {
    // Oud gedeeld beheerwachtwoord: laat de beheer-API het controleren (alleen actief als MTF_ADMIN_KEY is ingesteld).
    if (legacyKey.length > 500) throw Error("Log opnieuw in");
    const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/admin-api", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "x-admin-key": legacyKey },
      body: JSON.stringify({ action: "whoami" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error || !d.actor?.owner) throw Error("Log opnieuw in");
    return { email: "beheerwachtwoord", owner: true, active: true, permissions: {} };
  }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.length > 5000) throw Error("Log opnieuw in");
  const { data, error } = await root.auth.getUser(jwt);
  if (error || !data?.user) throw Error("Log opnieuw in");
  const m = await checked(root.from("mtf_staff").select("email,owner,active,permissions").eq("user_id", data.user.id).maybeSingle());
  if (!m?.active || !(m.owner || m.permissions?.shop)) throw Error("Geen rechten voor de game");
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ ok: false, error: "Alleen POST" }, 405);
  try {
    if (Number(req.headers.get("content-length") || 0) > 8000) throw Error("Verzoek te groot");
    const b = await req.json();
    const root = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const settings = await checked(root.from("mtf_game_settings").select("*").eq("id", true).single());

    // ---------- Publiek ----------
    if (b.action === "config") return reply({ ok: true, visible: settings.visible, title: settings.title });

    if (b.action === "leaderboard") {
      if (!settings.visible) return reply({ ok: true, visible: false, top: [] });
      const top = await checked(root.from("mtf_game_players").select("name,best_score").gt("best_score", 0).order("best_score", { ascending: false }).order("first_played_at").limit(10));
      return reply({ ok: true, visible: true, top: top.map((x: any) => ({ name: shortName(x.name), score: x.best_score })) });
    }

    if (b.action === "submit") {
      if (!settings.visible) throw Error("De game is momenteel niet actief.");
      if (b.website) return reply({ ok: true, message: "Score ontvangen." }); // honeypot
      const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const email = String(b.email || "").trim().toLowerCase();
      const score = Number(b.score);
      const optin = b.marketing === true;
      if (name.length < 2) throw Error("Vul je naam in.");
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error("Vul een geldig e-mailadres in.");
      if (!Number.isInteger(score) || score < 0 || score > 100000000) throw Error("Ongeldige score.");
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key) throw Error("E-mail is tijdelijk niet beschikbaar.");

      const ip = await sha(req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
      for (const [bucket, limit] of [["game:ip:" + ip, 60], ["game:email:" + (await sha(email)), 30], ["game:global", 3000]] as const) {
        const r = await root.rpc("mtf_promotion_rate", { p_bucket: bucket, p_limit: limit });
        if (r.error || !r.data) throw Error("Even rustig aan: probeer het over een uurtje opnieuw.");
      }

      const consent = `Ja, stuur mij ook acties en nieuws van ${B} per e-mail. Afmelden kan altijd.`;
      const id = await checked(root.rpc("mtf_game_record", { p_email: email, p_name: name, p_score: score, p_optin: optin, p_consent: consent, p_ip: ip }));
      const player = await checked(root.from("mtf_game_players").select("best_score,plays").eq("email", email).single());
      const { count } = await root.from("mtf_game_players").select("email", { count: "exact", head: true }).gt("best_score", player.best_score);
      const rank = (count || 0) + 1;

      let mailOk = true;
      try {
        const best = player.best_score > score ? `<p>Je beste score tot nu toe: <strong>${nl(player.best_score)}</strong>.</p>` : `<p><strong>Dit is je beste score tot nu toe!</strong></p>`;
        const rid = await sendMail(key, email, `Je score: ${nl(score)} – ${B} Game`,
          `Hoi ${name}, je score in de ${B} Game is ${nl(score)}. Je beste score: ${nl(player.best_score)}. Plaats op de ranglijst: ${rank}. Nog een keer spelen: ${SITE}/game`,
          `<p>Hoi ${esc(name)},</p><p>Bedankt voor het spelen! Je score:</p><p style="font-size:36px;font-weight:bold;color:${brand.color};margin:8px 0">${nl(score)}</p>${best}<p>Je staat op plaats <strong>${rank}</strong> van de ranglijst.</p><p><a style="background:${brand.color};color:white;padding:14px 20px;display:inline-block;border-radius:8px;text-decoration:none" href="${SITE}/game">Nog een keer spelen</a></p>`,
          "mtf-game-" + id);
        await root.from("mtf_game_scores").update({ mail_status: "sent", mail_error: null }).eq("id", id);
        void rid;
      } catch (e) {
        mailOk = false;
        await root.from("mtf_game_scores").update({ mail_status: "failed", mail_error: String(e).slice(0, 300) }).eq("id", id);
      }

      let newsletter = false;
      if (optin) {
        const tok = await root.rpc("mtf_game_contact_optin", { p_email: email, p_name: name });
        if (!tok.error && tok.data) {
          const url = `${SITE}/nieuwsbrief#confirm=${tok.data}`;
          try {
            const rid = await sendMail(key, email, "Bevestig je nieuwsbriefinschrijving",
              `Bevestig je inschrijving voor aanbiedingen van ${B}: ${url} . Geen aanvraag gedaan? Negeer deze mail.`,
              `<p>Je hebt via de game aangegeven dat je acties en nieuws van ${B} wilt ontvangen.</p><p><a href="${url}">Ja, bevestig mijn inschrijving</a></p><p>Deze link is 7 dagen geldig. Geen aanvraag gedaan? Negeer deze mail.</p>`,
              "mtf-confirm-" + tok.data);
            await root.from("mtf_mail_jobs").update({ status: "sent", resend_id: rid, sent_at: new Date().toISOString(), attempts: 1 }).eq("dedupe", "confirm:" + tok.data);
            newsletter = true;
          } catch (e) {
            await root.from("mtf_mail_jobs").update({ status: "failed", attempts: 1, last_error: String(e).slice(0, 300) }).eq("dedupe", "confirm:" + tok.data);
          }
        }
      }
      return reply({
        ok: true, rank, best: player.best_score, mail: mailOk, newsletter,
        message: mailOk ? "Je score is opgeslagen en naar je mail gestuurd." : "Je score is opgeslagen, maar de mail kon niet worden verstuurd.",
      });
    }

    // ---------- Beheer ----------
    if (String(b.action || "").startsWith("admin_")) {
      const actor = await staff(root, req);
      if (b.action === "admin_toggle") {
        if (typeof b.visible !== "boolean") throw Error("Ongeldige waarde");
        const s = await checked(root.from("mtf_game_settings").update({ visible: b.visible, updated_at: new Date().toISOString(), updated_by: actor.email }).eq("id", true).select("*").single());
        return reply({ ok: true, settings: s });
      }
      if (b.action === "admin_overview") {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const [players, plays, optins, today, failed, top, recent] = await Promise.all([
          root.from("mtf_game_players").select("email", { count: "exact", head: true }),
          root.from("mtf_game_scores").select("id", { count: "exact", head: true }),
          root.from("mtf_game_players").select("email", { count: "exact", head: true }).eq("marketing_optin", true),
          root.from("mtf_game_scores").select("id", { count: "exact", head: true }).gte("created_at", since),
          root.from("mtf_game_scores").select("id", { count: "exact", head: true }).eq("mail_status", "failed"),
          root.from("mtf_game_players").select("name,email,best_score,plays,marketing_optin,last_played_at").order("best_score", { ascending: false }).limit(20),
          root.from("mtf_game_scores").select("name,email,score,mail_status,created_at").order("created_at", { ascending: false }).limit(50),
        ]);
        for (const r of [players, plays, optins, today, failed, top, recent]) if (r.error) throw r.error;
        const emails = (top.data || []).map((x: any) => x.email);
        const subs = emails.length ? await checked(root.from("mtf_contacts").select("email,status").in("email", emails)) : [];
        const st = Object.fromEntries(subs.map((x: any) => [x.email, x.status]));
        return reply({
          ok: true, settings,
          stats: { players: players.count || 0, plays: plays.count || 0, optins: optins.count || 0, plays_24h: today.count || 0, mail_failed: failed.count || 0 },
          top: (top.data || []).map((x: any) => ({ ...x, newsletter: st[x.email] || "none" })),
          recent: recent.data || [],
        });
      }
      if (b.action === "admin_export") {
        const rows: any[] = [];
        for (let i = 0; i < 50000; i += 1000) {
          const page = await checked(root.from("mtf_game_players").select("*").order("first_played_at").range(i, i + 999));
          rows.push(...page); if (page.length < 1000) break;
        }
        const subs: any[] = [];
        for (let i = 0; i < rows.length; i += 300) subs.push(...await checked(root.from("mtf_contacts").select("email,status").in("email", rows.slice(i, i + 300).map((x) => x.email))));
        const st = Object.fromEntries(subs.map((x: any) => [x.email, x.status]));
        const q = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
        const csv = ["naam;email;keer_gespeeld;beste_score;laatste_score;wil_reclame;nieuwsbrief_status;eerste_keer;laatste_keer"]
          .concat(rows.map((x) => [x.name, x.email, x.plays, x.best_score, x.last_score, x.marketing_optin ? "ja" : "nee", st[x.email] || "none", x.first_played_at, x.last_played_at].map(q).join(";")))
          .join("\n");
        return reply({ ok: true, csv, count: rows.length });
      }
      throw Error("Onbekende beheeractie");
    }
    throw Error("Onbekende actie");
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : "Verzoek mislukt" }, 400);
  }
});
