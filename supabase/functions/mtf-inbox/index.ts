// Inbox van Mom's Thai Food in het beheerportaal (zelfde opzet als de inbox van Mijn Flowsmid).
// Leest de mailbox info@momsthaifood.nl via IMAP bij Hostnet, verstuurt mails via Resend
// en zet een kopie in de map Verzonden. Er wordt niets in de database opgeslagen.
// Geheimen (Supabase > Edge Functions > Secrets):
//   MTF_MAIL_WACHTWOORD  wachtwoord van de mailbox (verplicht om mails te lezen)
//   RESEND_API_KEY       bestaat al; nodig om te versturen
// Optioneel: MTF_MAIL_ADRES, MTF_IMAP_HOST, MTF_MAIL_AFZENDER.
// Toegang: alleen eigenaars (persoonlijk account, mtf_staff.owner en actief).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import PostalMime from "npm:postal-mime@2.4.4";

const ADRES = (Deno.env.get("MTF_MAIL_ADRES") ?? "info@momsthaifood.nl").trim().toLowerCase();
const HOST = Deno.env.get("MTF_IMAP_HOST") ?? "imap.hostnet.nl";
// Afzender bij versturen. Antwoorden van klanten gaan altijd naar de mailbox (reply_to), zodat ze in deze inbox verschijnen.
const AFZENDER = Deno.env.get("MTF_MAIL_AFZENDER") ?? "Mom's Thai Food <bestellingen@mail.momsthaifood.nl>";
const MAX_GROOTTE = 20 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class Fout extends Error {}

/* ---------- Kleine IMAP-client (alleen wat we nodig hebben) ---------- */
type Antwoord = { regel: string; lits: Uint8Array[] };
class Imap {
  conn!: Deno.TlsConn;
  buf = new Uint8Array(0);
  n = 0;
  dec = new TextDecoder("latin1");
  enc = new TextEncoder();

  async open() {
    this.conn = await Deno.connectTls({ hostname: HOST, port: 993 });
    const groet = await this.leesLogisch();
    if (!/^\* (OK|PREAUTH)/i.test(groet.regel)) throw new Fout("Mailserver gaf geen groet");
  }
  async vul() {
    const stuk = new Uint8Array(65536);
    const r = await this.conn.read(stuk);
    if (r === null) throw new Fout("Verbinding met de mailserver verbroken");
    const nieuw = new Uint8Array(this.buf.length + r);
    nieuw.set(this.buf); nieuw.set(stuk.subarray(0, r), this.buf.length);
    this.buf = nieuw;
  }
  async regel(): Promise<string> {
    while (true) {
      const i = this.buf.findIndex((b, j) => b === 13 && this.buf[j + 1] === 10);
      if (i >= 0) { const s = this.dec.decode(this.buf.subarray(0, i)); this.buf = this.buf.slice(i + 2); return s; }
      await this.vul();
    }
  }
  async bytes(n: number): Promise<Uint8Array> {
    const uit = new Uint8Array(n);
    let o = Math.min(n, this.buf.length);
    uit.set(this.buf.subarray(0, o)); this.buf = this.buf.slice(o);
    while (o < n) {
      const stuk = new Uint8Array(65536);
      const r = await this.conn.read(stuk);
      if (r === null) throw new Fout("Verbinding met de mailserver verbroken");
      const t = Math.min(r, n - o);
      uit.set(stuk.subarray(0, t), o); o += t;
      if (t < r) this.buf = stuk.slice(t, r);
    }
    return uit;
  }
  async leesLogisch(): Promise<Antwoord> {
    let regel = ""; const lits: Uint8Array[] = [];
    while (true) {
      const r = await this.regel(); regel += r;
      const m = r.match(/\{(\d+)\}$/);
      if (!m) return { regel, lits };
      if (Number(m[1]) > MAX_GROOTTE + 1024 * 1024) throw new Fout("Bericht is te groot");
      lits.push(await this.bytes(Number(m[1]))); regel += "\u0000";
    }
  }
  async schrijf(s: string | Uint8Array) { const b = typeof s === "string" ? this.enc.encode(s) : s; let o = 0; while (o < b.length) o += await this.conn.write(b.subarray(o)); }
  async cmd(c: string, literal?: Uint8Array): Promise<Antwoord[]> {
    const tag = "A" + (++this.n);
    const uit: Antwoord[] = [];
    if (literal) {
      await this.schrijf(`${tag} ${c} {${literal.length}}\r\n`);
      const r = await this.leesLogisch();
      if (!r.regel.startsWith("+")) throw new Fout("Mailserver weigerde: " + r.regel.slice(0, 120));
      await this.schrijf(literal); await this.schrijf("\r\n");
    } else await this.schrijf(`${tag} ${c}\r\n`);
    while (true) {
      const r = await this.leesLogisch();
      if (r.regel.startsWith(tag + " ")) {
        if (!/^\S+ OK/i.test(r.regel)) throw new Fout(r.regel.slice(tag.length + 1, 200));
        return uit;
      }
      uit.push(r);
    }
  }
  async sluit() { try { await this.cmd("LOGOUT"); } catch { /* maakt niet uit */ } try { this.conn.close(); } catch { /* al dicht */ } }
}
const q = (s: string) => '"' + s.replace(/[\\"]/g, (c) => "\\" + c) + '"';

async function verbind(): Promise<Imap> {
  const ww = Deno.env.get("MTF_MAIL_WACHTWOORD");
  if (!ww) throw new Fout("NIET_INGESTELD");
  const imap = new Imap();
  await imap.open();
  try { await imap.cmd(`LOGIN ${q(ADRES)} ${q(ww)}`); }
  catch { try { imap.conn.close(); } catch { /* al dicht */ } throw new Fout("Inloggen bij de mailbox lukte niet. Klopt het wachtwoord in MTF_MAIL_WACHTWOORD?"); }
  return imap;
}

async function mappen(imap: Imap) {
  const r = await imap.cmd('LIST "" "*"');
  return r.map((x) => {
    const m = x.regel.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i);
    if (!m) return null;
    let naam = m[2].trim();
    if (naam === "\u0000" && x.lits[0]) naam = new TextDecoder().decode(x.lits[0]);
    else if (naam.startsWith('"')) naam = naam.slice(1, -1).replace(/\\(.)/g, "$1");
    return { vlaggen: m[1].toLowerCase(), naam };
  }).filter(Boolean) as { vlaggen: string; naam: string }[];
}
async function verzondenMap(imap: Imap, maken = false) {
  const l = await mappen(imap);
  const gevonden = (l.find((m) => m.vlaggen.includes("\\sent")) ?? l.find((m) => /(^|[./])(sent|verzonden|sent items|verzonden items|sent messages)$/i.test(m.naam)))?.naam;
  if (gevonden || !maken) return gevonden ?? null;
  // Mailbox zonder map Verzonden: maak hem aan (met dezelfde scheiding als INBOX)
  const sep = (await imap.cmd('LIST "" "INBOX"')).map((x) => x.regel.match(/^\* LIST \([^)]*\) "(.)"/i)?.[1]).find(Boolean);
  const naam = l.some((m) => /^INBOX[./]/i.test(m.naam)) && sep ? `INBOX${sep}Sent` : "Sent";
  await imap.cmd(`CREATE ${q(naam)}`);
  try { await imap.cmd(`SUBSCRIBE ${q(naam)}`); } catch { /* niet erg */ }
  return naam;
}
async function kiesMap(imap: Imap, map: string, schrijven: boolean) {
  const naam = map === "verzonden" ? await verzondenMap(imap) : "INBOX";
  if (!naam) return null;
  await imap.cmd(`${schrijven ? "SELECT" : "EXAMINE"} ${q(naam)}`);
  return naam;
}

// deno-lint-ignore no-explicit-any
function adressen(a: any): { naam: string; adres: string }[] {
  const lijst = Array.isArray(a) ? a : a ? [a] : [];
  // deno-lint-ignore no-explicit-any
  return lijst.flatMap((x: any) => x?.group ? adressen(x.group) : [{ naam: String(x?.name ?? ""), adres: String(x?.address ?? "") }]).filter((x: { adres: string }) => x.adres);
}
function htmlNaarTekst(h: string) {
  return h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- Bericht opbouwen voor de map Verzonden ---------- */
function b64(s: string) { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); }
function kopWoord(s: string) { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }
function ruwBericht(o: { aan: string; onderwerp: string; tekst: string; msgId: string; inReplyTo?: string; references?: string }) {
  const kop = [
    `From: ${AFZENDER}`, `Reply-To: ${ADRES}`, `To: ${o.aan}`, `Subject: ${kopWoord(o.onderwerp)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${o.msgId}`, o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : "", o.references ? `References: ${o.references}` : "",
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  return new TextEncoder().encode([...kop, "", (b64(o.tekst).match(/.{1,76}/g) ?? []).join("\r\n"), ""].join("\r\n"));
}

Deno.serve(async (req) => {
  const antwoord = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return antwoord(405, { fout: "Niet toegestaan" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return antwoord(401, { fout: "Log in met je persoonlijke account om de inbox te gebruiken." });
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) return antwoord(401, { fout: "Sessie verlopen. Log opnieuw in." });
  const { data: ik } = await admin.from("mtf_staff").select("owner,active").eq("user_id", u.user.id).maybeSingle();
  if (!(ik?.owner && ik?.active)) return antwoord(403, { fout: "Alleen de eigenaar kan de inbox gebruiken." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return antwoord(400, { fout: "Ongeldig verzoek" }); }
  const actie = String(body.actie ?? "");
  const map = body.map === "verzonden" ? "verzonden" : "inbox";
  const uid = Number(body.uid);
  const uidOk = Number.isInteger(uid) && uid > 0;
  const ingesteld = !!Deno.env.get("MTF_MAIL_WACHTWOORD");

  if (actie === "status") return antwoord(200, { ok: true, adres: ADRES, afzender: AFZENDER, ingesteld, versturen: !!Deno.env.get("RESEND_API_KEY") });

  let imap: Imap | null = null;
  try {
    // Aantal ongelezen mails, voor de teller in het menu.
    if (actie === "ongelezen") {
      if (!ingesteld) return antwoord(200, { ok: true, ingesteld: false, ongelezen: 0 });
      imap = await verbind();
      const r = await imap.cmd("STATUS INBOX (UNSEEN)");
      const n = Number(r.map((x) => x.regel.match(/UNSEEN (\d+)/i)?.[1]).find(Boolean) ?? 0);
      return antwoord(200, { ok: true, ingesteld: true, ongelezen: n });
    }

    if (actie === "lijst") {
      imap = await verbind();
      if (!await kiesMap(imap, map, false)) return antwoord(200, { ok: true, adres: ADRES, map, totaal: 0, berichten: [], meer: false });
      const zoek = await imap.cmd("UID SEARCH ALL");
      const alle = zoek.flatMap((r) => r.regel.startsWith("* SEARCH") ? r.regel.slice(8).trim().split(/\s+/).filter(Boolean).map(Number) : []).sort((a, b) => b - a);
      const voor = Number(body.voor) || Infinity;
      const uids = alle.filter((x) => x < voor).slice(0, 40);
      const berichten = [];
      if (uids.length) {
        const r = await imap.cmd(`UID FETCH ${uids.join(",")} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])`);
        for (const x of r) {
          if (!/^\* \d+ FETCH/i.test(x.regel) || !x.lits[0]) continue;
          const k = await PostalMime.parse(x.lits[0]);
          const vlaggen = x.regel.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? "";
          berichten.push({
            uid: Number(x.regel.match(/UID (\d+)/i)?.[1]),
            gelezen: /\\Seen/i.test(vlaggen),
            beantwoord: /\\Answered/i.test(vlaggen),
            datum: k.date ? new Date(k.date).toISOString() : (x.regel.match(/INTERNALDATE "([^"]+)"/i)?.[1] ?? null),
            van: adressen(k.from)[0] ?? null,
            aan: adressen(k.to),
            onderwerp: k.subject ?? "",
            grootte: Number(x.regel.match(/RFC822\.SIZE (\d+)/i)?.[1] ?? 0),
          });
        }
        berichten.sort((a, b) => b.uid - a.uid);
      }
      return antwoord(200, { ok: true, adres: ADRES, map, totaal: alle.length, berichten, meer: alle.filter((x) => x < voor).length > uids.length });
    }

    if (actie === "lees") {
      if (!uidOk) return antwoord(400, { fout: "Ongeldig bericht" });
      imap = await verbind();
      if (!await kiesMap(imap, map, true)) return antwoord(404, { fout: "Map niet gevonden" });
      const g = await imap.cmd(`UID FETCH ${uid} (RFC822.SIZE)`);
      const grootte = Number(g.map((x) => x.regel.match(/RFC822\.SIZE (\d+)/i)?.[1]).find(Boolean) ?? 0);
      if (!grootte) return antwoord(404, { fout: "Bericht niet gevonden" });
      if (grootte > MAX_GROOTTE) return antwoord(400, { fout: "Dit bericht is te groot om hier te openen. Open het in de webmail van Hostnet." });
      const r = await imap.cmd(`UID FETCH ${uid} (UID FLAGS BODY[])`);
      const x = r.find((y) => /^\* \d+ FETCH/i.test(y.regel) && y.lits[0]);
      if (!x) return antwoord(404, { fout: "Bericht niet gevonden" });
      const m = await PostalMime.parse(x.lits[0]);
      const tekst = (m.text && m.text.trim()) ? m.text : m.html ? htmlNaarTekst(m.html) : "";
      return antwoord(200, {
        ok: true, uid,
        van: adressen(m.from)[0] ?? null, aan: adressen(m.to), cc: adressen(m.cc), antwoordAan: adressen(m.replyTo)[0] ?? null,
        onderwerp: m.subject ?? "", datum: m.date ? new Date(m.date).toISOString() : null,
        // deno-lint-ignore no-explicit-any
        messageId: m.messageId ?? null, references: (m.headers ?? []).find((k: any) => k.key === "references")?.value ?? null,
        tekst: tekst.slice(0, 200000), wasHtml: !(m.text && m.text.trim()) && !!m.html,
        // deno-lint-ignore no-explicit-any
        bijlagen: (m.attachments ?? []).filter((a: any) => a.disposition !== "inline" || a.filename).map((a: any, i: number) => ({ nr: i, naam: a.filename || "bijlage", type: a.mimeType, grootte: (a.content as ArrayBuffer)?.byteLength ?? 0 })),
      });
    }

    if (actie === "bijlage") {
      if (!uidOk) return antwoord(400, { fout: "Ongeldig bericht" });
      const nr = Number(body.nr);
      imap = await verbind();
      if (!await kiesMap(imap, map, false)) return antwoord(404, { fout: "Map niet gevonden" });
      const r = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
      const x = r.find((y) => /^\* \d+ FETCH/i.test(y.regel) && y.lits[0]);
      if (!x) return antwoord(404, { fout: "Bericht niet gevonden" });
      const m = await PostalMime.parse(x.lits[0]);
      // deno-lint-ignore no-explicit-any
      const lijst = (m.attachments ?? []).filter((a: any) => a.disposition !== "inline" || a.filename);
      // deno-lint-ignore no-explicit-any
      const a: any = lijst[nr];
      if (!a) return antwoord(404, { fout: "Bijlage niet gevonden" });
      const naam = String(a.filename || "bijlage").replace(/[\r\n"\\]/g, "_").slice(0, 150);
      return new Response(a.content, { status: 200, headers: { ...cors, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${naam.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(naam)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }

    if (actie === "markeer") {
      if (!uidOk) return antwoord(400, { fout: "Ongeldig bericht" });
      imap = await verbind();
      if (!await kiesMap(imap, map, true)) return antwoord(404, { fout: "Map niet gevonden" });
      await imap.cmd(`UID STORE ${uid} ${body.gelezen === false ? "-" : "+"}FLAGS.SILENT (\\Seen)`);
      return antwoord(200, { ok: true });
    }

    if (actie === "versturen") {
      const sleutel = Deno.env.get("RESEND_API_KEY");
      if (!sleutel) return antwoord(400, { fout: "Versturen kan pas als de mailprovider (Resend) is ingesteld." });
      const aan = String(body.aan ?? "").trim().toLowerCase();
      const onderwerp = String(body.onderwerp ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 250);
      const tekst = String(body.tekst ?? "").slice(0, 50000);
      if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(aan)) return antwoord(400, { fout: "Het e-mailadres klopt niet." });
      if (!onderwerp || !tekst.trim()) return antwoord(400, { fout: "Vul een onderwerp en een bericht in." });
      const schoon = (s: unknown) => { const v = String(s ?? "").trim(); return /^<[^<>\s\r\n]{3,300}>$/.test(v) ? v : null; };
      const inReplyTo = schoon(body.in_reply_to);
      const refs = String(body.references ?? "").split(/\s+/).map(schoon).filter(Boolean).slice(-10) as string[];
      if (inReplyTo && !refs.includes(inReplyTo)) refs.push(inReplyTo);
      const msgId = `<${crypto.randomUUID()}@momsthaifood.nl>`;
      const headers: Record<string, string> = { "Message-ID": msgId };
      if (inReplyTo) { headers["In-Reply-To"] = inReplyTo; headers["References"] = refs.join(" "); }
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json", "Idempotency-Key": "mtf-inbox-" + String(body.sleutel ?? crypto.randomUUID()).replace(/[^\w-]/g, "").slice(0, 80) },
        body: JSON.stringify({ from: AFZENDER, to: [aan], reply_to: ADRES, subject: onderwerp, text: tekst, headers }),
      });
      if (!r.ok) return antwoord(502, { fout: "Versturen lukte niet: " + (await r.text()).slice(0, 200) });
      // Kopie in Verzonden en het origineel als beantwoord markeren (lukt dat niet, dan is de mail wel verstuurd)
      let kopie = false;
      if (ingesteld) {
        try {
          imap = await verbind();
          const vm = await verzondenMap(imap, true);
          if (vm) { await imap.cmd(`APPEND ${q(vm)} (\\Seen)`, ruwBericht({ aan, onderwerp, tekst, msgId, inReplyTo: inReplyTo ?? undefined, references: refs.join(" ") || undefined })); kopie = true; }
          if (uidOk) { await imap.cmd("SELECT INBOX"); await imap.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Answered)`); }
        } catch { /* niet erg */ }
      }
      return antwoord(200, { ok: true, kopie });
    }

    return antwoord(400, { fout: "Onbekende actie" });
  } catch (e) {
    if (e instanceof Fout && e.message === "NIET_INGESTELD") return antwoord(200, { ok: false, ingesteld: false, fout: "De mailbox is nog niet gekoppeld." });
    return antwoord(502, { fout: e instanceof Fout ? e.message : "De mailbox is nu niet bereikbaar. Probeer het zo opnieuw." });
  } finally {
    if (imap) await imap.sluit();
  }
});
