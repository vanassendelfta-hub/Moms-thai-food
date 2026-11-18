# Nieuwe klant opzetten

Elke klant krijgt een eigen Supabase-project (database, opslag, serverfuncties) en een eigen websitekopie op Vercel.
De code is voor iedereen gelijk; alles wat per klant verschilt, staat in instellingen.
Reken op ongeveer een halve dag, waarvan het meeste wachten is op DNS en de mailverificatie.

## 1. Gegevens verzamelen

| Gegeven | Voorbeeld | Waar het terechtkomt |
|---|---|---|
| Merknaam | Bangkok Bites | `{{MERKNAAM}}`, `MTF_BRAND_NAME`, `site-config.js` |
| Slug hoofdvestiging | rotterdam-centrum | `{{SLUG}}`, `site-config.js` |
| Naam en adres vestiging | Bangkok Bites Rotterdam, Coolsingel 1 | `{{NAAM}}`, `{{ADRES}}` |
| Ordermail (ontvangt nieuwe bestellingen) | bestellingen@bangkokbites.nl | `{{ORDERMAIL}}` |
| Voorvoegsel bestelnummer | BB | `{{BESTELNUMMER_VOORVOEGSEL}}` |
| Websitedomein | bangkokbites.nl | Vercel, `MTF_SITE_URL`, `productionHosts` |
| Maildomein voor verzenden | mail.bangkokbites.nl | Resend, `MTF_MAIL_FROM` |
| Mollie-account (eigen account van de klant) | live_… | `MOLLIE_API_KEY` |
| Pakket en modules | Basis: zonder game en campagnes | `site-config.js` → `modules` |
| Huisstijl | kleuren, lettertypes, logo | `theme.css`, sjablonen |

## 2. Supabase-project

1. Nieuw project aanmaken (regio Frankfurt, eu-central-1). Noteer URL, publishable key en service-role key.
2. In de SQL-editor, in deze volgorde:
   1. `supabase/platform/0001_schema_public.sql`, met `{{MERKNAAM}}` vervangen.
   2. `supabase/platform/0002_bootstrap.sql`, met alle `{{...}}` ingevuld (`{{SUPABASE_URL}}` = projecturl, `{{SERVICE_ROLE_KEY}}` = service-role key).
   3. Alleen als de klant een tweede vestiging heeft: `location_schema_template.sql` met `__LOCATION_SCHEMA__` → bijv. `mtf_rotterdam_zuid`. Daarna:
      ```sql
      insert into public.mtf_locations (slug, schema_name, name, address, order_email, published, mailbox_ready, is_primary, order_prefix, order_pad)
      values ('rotterdam-zuid','mtf_rotterdam_zuid','Bangkok Bites Rotterdam-Zuid','…','…',false,false,false,'BBZ',5);
      alter role authenticator set pgrst.db_schemas = 'public,graphql_public,mtf_rotterdam_zuid';
      notify pgrst, 'reload config'; notify pgrst, 'reload schema';
      ```
3. Extra's per vestiging (alleen als de klant ze afneemt):
   `update public.mtf_locations set features = array['welkom10','seasonal','marketing'] where slug = '…';`
4. Authentication → URL Configuration: Site URL = `https://<domein>/admin.html`, redirect toegestaan voor `https://<domein>/**`.

## 3. Geheimen (Edge Function Secrets)

| Geheim | Verplicht | Waarde |
|---|---|---|
| `RESEND_API_KEY` | ja | sleutel van Resend (eigen of platformaccount) |
| `MOLLIE_API_KEY` | alleen bij online betalen | sleutel van het Mollie-account van de klant |
| `MTF_BRAND_NAME` | ja | merknaam zoals klanten die zien (mag ’ bevatten) |
| `MTF_MAIL_NAME` | ja | merknaam in de afzender (rechte apostrof) |
| `MTF_SITE_URL` | ja | `https://bangkokbites.nl` |
| `MTF_ADMIN_URL` | ja | `https://bangkokbites.nl/admin.html` |
| `MTF_SITE_ORIGINS` | ja | alle websiteadressen, komma-gescheiden; de eerste is de standaard |
| `MTF_MAIL_FROM` | ja | `bestellingen@mail.bangkokbites.nl` |
| `MTF_REPLY_TO` | ja | `info@bangkokbites.nl` |
| `MTF_MAIL_DOMAIN` | ja | `bangkokbites.nl` |
| `MTF_PLACE` | ja | vestigingsplaats voor de voettekst |
| `MTF_ADDRESS` | ja | adres voor de voettekst van de couponmail |
| `MTF_TAGLINE` | nee | slogan onder mails |
| `MTF_BRAND_COLOR` | nee | hoofdkleur in mails, bijv. `#1d4ed8` |
| `MTF_LOGO_URL`, `MTF_ORDER_MAIL_LOGO_URL` | nee | logo's in mails (openbare https-afbeelding) |
| `MTF_HEADER_LINES` | nee | kop van de bestelmail, regels gescheiden door `\|` |

Zonder deze geheimen gebruikt de servercode de waarden van Mom's Thai Food. Vul ze dus **altijd** in.
Stel `MTF_ADMIN_KEY` nooit in: het oude gedeelde beheerwachtwoord is alleen voor terugval bij Mom's Thai Food.

## 4. Serverfuncties uitrollen

Eerst `python3 tools/sync_shared.py --check`: alle kopieën van de gedeelde bestanden moeten gelijk zijn.

| Functie | JWT controleren | Map |
|---|---|---|
| place-order | nee | `supabase/functions/place-order` |
| admin-api | nee | `supabase/functions/admin-api` |
| admin-hours | nee | `supabase/functions/admin-hours` |
| mollie-pay | nee | alleen bij module onlinePayment |
| promotions | nee | alleen bij modules promotions/welkom10 |
| site-stats | nee | alleen bij module stats |
| game | nee | alleen bij module game |
| dynamic-handler | **ja** | bestelmails |
| portal-mail-worker | nee | overige mails |
| review-mail-worker | nee | reviewmails |

In Mollie: webhook gaat automatisch naar `<SUPABASE_URL>/functions/v1/mollie-pay?webhook=1`.

## 5. Mail (Resend)

Domein toevoegen, DNS-records zetten bij de klant, wachten op "Verified". Pas daarna mailen de functies.

## 6. Website

1. Nieuwe Vercel-map of -project vanuit deze repository (branch per klant, of een kopie van de klantbestanden).
2. `site-config.js` invullen:
   - `name`, `supabaseUrl`, `publishableKey`, `productionHosts` (alle productiedomeinen), `test` (testproject of leeg);
   - `defaultLocation` en `locations` (per vestiging `cartKey`, `orderNumber`, `features`, optioneel `page`);
   - `modules`: alleen wat in het pakket zit;
   - `fallbackPhotos`: standaardfoto's bij gerechten zonder foto.
3. Huisstijl in `theme.css` (kleuren en lettertypes). Een eigen ontwerp vervangt sjablonen via `MTF.templates.use` (zie `ELEMENT-CONTRACT.md`).
4. Teksten en afbeeldingen in de HTML-pagina's (home, menu, contact, privacy) aanpassen.
5. Domein koppelen in Vercel.

## 7. Eerste eigenaar

In de SQL-editor, na registratie van het e-mailadres via Authentication → Users → Invite:
```sql
insert into public.mtf_staff (user_id, email, name, owner, active, permissions)
select id, email, '{{NAAM EIGENAAR}}', true, true, '{}'::jsonb from auth.users where email = '{{EMAIL EIGENAAR}}';
```
De eigenaar logt in via `/admin.html`, vult menu, openingstijden en sluitingsdagen in en nodigt medewerkers uit.

## 8. Controle voor livegang

- [ ] Testbestelling afhalen en bezorgen (contant) → bevestigingsmail klant en melding restaurant komen binnen.
- [ ] Online betalen met Mollie-testsleutel (`test_…`), daarna live sleutel.
- [ ] Bestelnummer heeft het juiste voorvoegsel.
- [ ] Beheer: bestelling op "Klaar" en "Bezorgd" → reviewmail na een uur.
- [ ] Modules die uit staan zijn nergens zichtbaar.
- [ ] Geen "Mom's Thai Food" in mails, pagina's of tabbladtitels.
- [ ] Winkel openen in het beheer, vestiging `published = true`.
