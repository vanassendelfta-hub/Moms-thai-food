# Draaiboek livegang fase 4

Alleen op een sluitingsdag, met Anthony erbij. Live = Supabase `uywydquzvdbpfjjrwsbt` + Vercel-project `prj_DTsqy5ymSJgGXaQgMA0SU0q5BYPv`.
Live krijgt alleen schemawijzigingen en code; er worden geen gegevens overgezet uit test.

Volgorde is belangrijk: eerst de database (verruimt alleen en voegt toe, oude code blijft werken), dan de servercode, dan de website.

## 0. Vooraf (± 15 min)

1. Controleer dat er geen open bestellingen zijn (Overzicht in beheer) en dat de winkel dicht staat.
2. Noteer voor terugdraaien:
   - huidige productie-uitrol van de website (Vercel `list_deployments`, target production) → id opschrijven;
   - huidige versie van elke functie (`list_edge_functions` op live) → versienummers opschrijven;
   - `list_migrations` op live → laatste migratie opschrijven.
3. Haal de live broncode van `admin-api` op (`get_edge_function`) en bewaar `materials.ts` **alleen in de werkmap**
   (niet committen: de repository is openbaar en dit bestand bevat het marketingplan en de teamvideo).
4. Repository: `git checkout platform && python3 tools/sync_shared.py --check` → moet `klaar` geven.

## 1. Database (± 10 min)

1. Migratie `supabase/migrations/20261118120000_flexible_locations.sql` toepassen (`apply_migration`, naam `flexible_locations`).
   Dit bestand bevat ook de bestelnummering (in test stond die als aparte vervolgmigratie `flexible_locations_numbering`); live is dus één migratie genoeg.
   De hulpfuncties `platform_schema_export_helper` en `platform_bootstrap_helper` uit test gaan **niet** naar live.
2. Migratie `supabase/migrations/20261118140000_platform_health.sql` toepassen (`platform_health`).
3. Controleren:
   - `select slug, is_primary, schema_name, features, order_prefix, order_pad, order_max from mtf_locations;`
     → Spijkenisse `is_primary = true`, schema `public`, features `{welkom10,seasonal,marketing}`;
       Oud-Beijerland `is_primary = false`, schema `mtf_ob`, features leeg, prefix/pad/max zoals voorheen.
   - `select public.mtf_location_schema('oud-beijerland');` → `mtf_ob`.
   - `select count(*) from public.mtf_dish_popularity(...)` geeft hetzelfde als vóór de migratie (zelfde query vooraf draaien).
   - Website live nog even openen: menu en bestellen werken nog met de oude code.

## 2. Servercode (± 30 min)

Uitrollen vanaf branch `platform`, altijd met de gedeelde bestanden (`locations.ts`, `brand.ts`, en waar van toepassing `portal.ts`, `addon-rules.ts`).
Geen `MTF_*`-secrets zetten op live: zonder secrets gelden de waarden van Mom's Thai Food.

| Functie | verify_jwt | Extra bestanden |
|---|---|---|
| place-order | false | locations.ts, brand.ts, addon-rules.ts |
| admin-hours | false | locations.ts, brand.ts |
| admin-api | false | alle 12 bestanden, **met de live `materials.ts` uit stap 0.3** |
| mollie-pay | false | locations.ts, brand.ts |
| promotions | false | locations.ts, brand.ts, addon-rules.ts |
| site-stats | false | locations.ts, brand.ts |
| game | false | locations.ts, brand.ts |
| review-mail-worker | false | render.ts, locations.ts, brand.ts |
| portal-mail-worker | false | portal.ts, locations.ts, brand.ts |
| dynamic-handler | **true** | locations.ts, brand.ts |

Controleer vóór elke uitrol de huidige `verify_jwt` op live met `get_edge_function`; wijkt die af van de tabel, dan de live-waarde aanhouden en melden.

Na de uitrol, per functie:
- `dynamic-handler` met `{"health":true}` (service-sleutel, via `net.http_post`) → `resend_configured: true`.
- `mollie-pay` config, `promotions` config, `game` config/leaderboard, `site-stats` hit → 200.
- Workers zonder sleutel → 403.

## 3. Website (± 15 min)

1. `git push origin platform:website`.
2. Wachten op de preview-uitrol van Vercel; preview openen en controleren:
   menu Spijkenisse en Oud-Beijerland, mandje, afrekenen tot aan de betaalkeuze, beheer inloggen.
3. Promoveren: `create_deployment` met `{name, project, deploymentId: <preview>, target: "production"}`.

## 4. Controle na livegang (± 20 min)

- Echte proefbestelling Spijkenisse (afhalen, betalen bij afhalen) → bevestigingsmail klant + melding restaurant komen binnen,
  bestelnummer zelfde opmaak als voorheen. Daarna in beheer annuleren.
- Proefbestelling met iDEAL (klein bedrag) → Mollie-betaalpagina, terug naar betaald.html, status Betaald.
- WELKOM10 werkt in Spijkenisse, niet in Oud-Beijerland.
- Beheer: eigenaar ziet alle tabbladen; medewerker alleen zijn rechten; Vestigingen-tab werkt.
- Platformbeheer-scherm: Mom's Thai Food toont nu de volledige gezondheidscontrole.
- Na 1 uur: reviewmail-wachtrij heeft de proefbestelling (wordt geannuleerd omdat die geannuleerd is).

## 5. Terugdraaien

Volgorde omgekeerd; de database hoeft meestal niet terug (de migraties verruimen alleen).
1. Website: vorige productie-uitrol opnieuw promoveren (id uit stap 0.2).
2. Functies: vorige versies opnieuw uitrollen vanaf commit `04f0ba6` (laatste live stand) met dezelfde `verify_jwt`;
   `admin-api` weer met de live `materials.ts`.
3. Alleen als het echt nodig is: database. `mtf_platform_health` mag blijven staan.
   De nieuwe kolommen (`is_primary`, `features`, `order_*`) hinderen de oude code niet.

## Na afloop

- `PHASE4-STATUS.md` bijwerken (live-datum, uitrol-id's, functieversies).
- Platformbeheer: Mom's Thai Food → versie/notitie bijwerken.
- Tijdelijke werkbestanden met `materials.ts` verwijderen.
