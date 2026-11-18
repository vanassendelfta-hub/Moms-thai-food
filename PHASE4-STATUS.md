# Fase 4 – meerdere klanten

Alles in deze fase gebeurt eerst op de branch `platform` en in de testdatabase (ipbvjszctqgtidcouidc).
Live alleen samen met Anthony, op een sluitingsdag.

## 4a. Vestigingen en merk niet meer vast in de code — klaar (test)

Website
- `site-config.js`: per vestiging `cartKey`, `orderNumber`, `features` (welkom10, seasonal, marketing) en optioneel `page` (titel, balktekst, tekstvervanging, contact, telefoon verbergen, adresvelden).
- Gedeelde scripts (branch.js, welkom10.js, welkom3.js, index.html, betaald.html, admin-feestdagen.js, admin-locations.js) kennen geen vestigingsnamen meer.
- Het formulier "vestiging gereedmaken" in admin.html noemt zijn vestiging via `data-slug`.

Database (migratie `20261118120000_flexible_locations.sql`, alleen test)
- `mtf_locations`: `is_primary` (precies één, altijd schema public), `features`, `order_prefix`/`order_pad`/`order_max`.
- Vaste lijsten (`slug in (spijkenisse, oud-beijerland)`, `schema in (public, mtf_ob)`) vervangen door formaatcontroles; reviewmails verwijzen naar `mtf_locations`.
- `mtf_location_schema(slug)`; `mtf_dish_popularity` en `mtf_enqueue_review_mail` werken voor elke vestiging.

Servercode (supabase/functions)
- `locations.ts` (drie kopieën, zelfde kern): hoofdvestiging en schema uit de tabel, `hasFeature`, `orderNumber`.
- `brand.ts`: merknaam, website, afzender, reply-to, plaats, slogan en kleur via secrets `MTF_*`; standaard de waarden van Mom's Thai Food.
- `place-order`: WELKOM10, feestdagenmenu en nieuwsbrief volgen `features`.
- `admin-api`: betaal-/campagne-/uitnodigingsmails via `brand`; feestdagenbeheer via `features`; `location_provision_manager` is algemeen (slug, e-mail, naam) en bevat geen persoonlijke gegevens meer.

Getest
- Website oud tegen nieuw: 60 combinaties pagina × vestiging × open/dicht gelijk; mandje, HTML, paginaverzoeken en bestelflow gelijk.
- Database: populariteit (alle vestigingen, ook met tijdelijke OB-bestellingen) en reviewmail-vestiging gelijk aan voorheen.
- Bestelnummers server: 57.154 gevallen gelijk aan de oude formule.
- Echte testfunctie `place-order` (test): standaardvestiging, onbekende/ongeldige vestiging, WELKOM10 en feestdagenmenu alleen bij Spijkenisse, nieuwsbrief alleen bij Spijkenisse, offertes kloppen.
- Echte testfunctie `admin-hours` (test): eigenaar standaard Spijkenisse en toegang tot beide; medewerker alleen Spijkenisse; onbekende vestiging geweigerd.

Nog te doen bij livegang 4a
- `admin-api` is aangepast maar nog niet naar test of live gezet (te groot voor één upload via deze koppeling; eerst `materials.ts` naar privé-opslag, dan uitrollen).
- Migratie op live draaien (voegt alleen kolommen toe en verruimt controles; oude servercode blijft werken).
- Daarna `place-order`, `admin-hours`, `admin-api` live uitrollen, dan de website.

## 4b. Extra's als modules aan/uit — klaar (website, nog niet live)

- `site-config.js`: `modules` (lijst) met `SITE_CONFIG.module(naam)` en `SITE_CONFIG.include(naam, src)`.
  Website: onlinePayment, promotions, welkom10, campaigns, homeDeals, cinematicMenu, game, infoDock, stats.
  Beheer: tasks, map, warehouse, finance, receipts, seasonal, adminPromotions, addons, siteStats.
- Pagina's laden modulescripts via `SITE_CONFIG.include` (zelfde volgorde als een scripttag).
- schedule.js (iDEAL/Wero), branch.js (spel, infodock, statistieken) controleren hun module.
- `admin-modules.js` verbergt tabbladen en knoppen van uitgeschakelde modules.
- Getest: alles aan = gelijk aan voorheen (paginaverzoeken, mandje, HTML, bestelflow).
  Alles uit = geen modulescripts of -aanroepen, geen iDEAL-keuze, bestellen werkt, beheer toont alleen Overzicht,
  Bestellingen, Gerechten, Gebruikers en Openingstijden; geen fouten.
- Later (platformbeheer): modules ook op de server afdwingen voor betaalde pakketten.
## 4c. Nieuwe klant opzetten — klaar (bestanden en handleiding; nog geen echte tweede klant)

- Alle serverfuncties staan nu in de repository (eerder ontbraken mollie-pay, promotions, site-stats, game,
  review-mail-worker, portal-mail-worker en dynamic-handler). Vaste vestigingen, websiteadressen, merknaam,
  logo's en adres zijn vervangen door `locations.ts` en `brand.ts`.
- Gedeelde serverbestanden staan in `supabase/functions/_shared/`; `tools/sync_shared.py` kopieert ze naar elke functie
  (`--check` controleert).
- `supabase/platform/`: volledig schema (hoofdvestiging), opstartgedeelte (extensies, opslag, startinstellingen,
  hoofdvestiging, geplande mailtaken) en sjabloon voor een extra vestiging; generatoren in `platform_tools.sql`.
  Getest in een teruggedraaide transactie in de testdatabase: alles bouwt op, aantallen gelijk aan het origineel.
- `PLATFORM-NIEUWE-KLANT.md`: stappenplan, lijst met geheimen, uitrol van functies en controlelijst.
- De nieuwe versies van de zeven functies zijn nog niet uitgerold (test heeft bewust geen mail/Mollie);
  bij livegang samen uitrollen en controleren met een echte bestelling.
- Nog open: een echte proefinstallatie in een leeg Supabase-project (gratis plan: maximaal 2 actieve projecten).
## 4d. Platformbeheer — eerste versie klaar

- Scherm "Platformbeheer" (privé artifact: https://claude.ai/artifact/BxskkUiPk3sqyKY5M94iPs), broncode in
  `tools/platform-dashboard/index.html`.
  - Klanten met status, pakket, abonnement, opstartkosten, startdatum, modules, koppelingen en notities;
    opgeslagen in de privé-opslag van het artifact (alleen eigenaar/bewerkers lezen en schrijven).
  - Samenvatting: actieve klanten, abonnementen per maand, opstartkosten dit jaar, klanten met aandacht nodig.
  - Controle per klant via jouw eigen Supabase- en Vercel-koppeling (geen sleutels in de pagina):
    databasestatus, bestelmails, overige mails, reviewmails, geplande taken, bestellingen per vestiging,
    laatste uitrol en commit van de website.
- Migratie `20261118140000_platform_health.sql`: leesfunctie `mtf_platform_health()` (alleen service-rol).
  Toegepast op test; live nog niet (het scherm valt daar terug op een eenvoudige controle en meldt dat).
- Mom's Thai Food en de testomgeving zijn als eerste twee klanten vastgelegd.
- Later: modules ook op de server afdwingen, factuuroverzicht per maand, uitrollen per klant vanuit het scherm.
