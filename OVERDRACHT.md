# Overdracht: van Mom's Thai Food naar het platform (stand 18 november 2026)

Voor een nieuwe chat die de pilot voor een tweede restaurant bouwt. Geen sleutels of wachtwoorden in dit bestand: de repository is openbaar.

## Waar staat wat

| Onderdeel | Waar |
|---|---|
| Code | GitHub `vanassendelfta-hub/Moms-thai-food` (openbaar), branch `platform` = nieuwste stand, branch `website` = live |
| Live database | Supabase `uywydquzvdbpfjjrwsbt` (Mom's Thai Food) — **niet aankomen zonder Anthony** |
| Testdatabase | Supabase `ipbvjszctqgtidcouidc` (geanonimiseerde kopie, geen mail/Mollie) |
| Website | Vercel-project `prj_DTsqy5ymSJgGXaQgMA0SU0q5BYPv` (team `team_KmdJ85SaFyrrsCbVPhV6bkCB`) |
| Platformbeheer | privé artifact https://claude.ai/artifact/BxskkUiPk3sqyKY5M94iPs (bron: `tools/platform-dashboard/index.html`) |
| Pilotdatabase | Supabase `xxctsddwduviiqpzlsij` ("Pilot Restaurant", eu-central-1, leeg; aangemaakt 18-11-2026 met akkoord Anthony; naam mag naar de klant) |
| Supabase-plan | gratis: maximaal 2 actieve projecten. Nu actief: live + pilot. Test `ipbvjszctqgtidcouidc` is **gepauzeerd** (akkoord Anthony); Kordaxis en VANAS Steel ook gepauzeerd |

## Afspraken met Anthony

- Eén code-motor voor alle klanten; per klant een eigen Supabase-project, eigen ontwerp, eigen modules.
- Codewijzigingen (nieuwe/verbeterde functies) gaan naar alle klanten, gecontroleerd per klant uitgerold.
  Beheerinstellingen en gegevens blijven per klant. Ontwerp blijft per klant.
- Pakketten Basis en Maatwerk: opstartkosten + maandbedrag (vastleggen in Platformbeheer).
- Live alleen op een sluitingsdag en met Anthony erbij. Live krijgt schemamigraties, nooit samengevoegde gegevens.
- Nooit geheimen, het marketingplan of de teamvideo committen (`admin-api/materials.ts` blijft een stub).
- Testgegevens zijn geanonimiseerd. Geen echte klantgegevens naar test of pilot.
- Pilot: los Supabase-project. Omdat het gratis plan 2 projecten toestaat, wordt test tijdelijk gepauzeerd.
  **Pauzeren en een nieuw project aanmaken alleen na uitdrukkelijk akkoord van Anthony.**

## Stand van de techniek

- Fase 3 (mandje, bestelregels, sjablonen) staat live.
- Fase 4 (meerdere klanten) staat klaar op `platform` en in test, nog niet live. Zie `PHASE4-STATUS.md` en `LIVEGANG-FASE4.md`.
  - 4a: vestigingen en merk uit de code (`site-config.js`, `_shared/locations.ts`, `_shared/brand.ts` met `MTF_*`-secrets).
  - 4b: modules aan/uit per klant (`SITE_CONFIG.modules`, `admin-modules.js`).
  - 4c: nieuwe klant opzetten: `supabase/platform/` (schema, opstart met `{{...}}`-plaatshouders, vestigingssjabloon)
    en stappenplan `PLATFORM-NIEUWE-KLANT.md`.
  - 4d: Platformbeheer + `mtf_platform_health()`.
- Gedeelde serverbestanden: wijzig alleen `supabase/functions/_shared/`, daarna `python3 tools/sync_shared.py` (en `--check`).

## Zo bouw je de pilot (kort; details in PLATFORM-NIEUWE-KLANT.md)

1. Gegevens van de klant verzamelen: naam, mailnaam, domein, adres, plaats, slogan, kleur, logo, vestiging(en), openingstijden,
   bezorgregels, menu met prijzen en foto's, gewenste modules en pakket.
2. Gedaan: test is gepauzeerd en het pilotproject `xxctsddwduviiqpzlsij` bestaat (nog leeg). Begin hier bij stap 3.
3. Schema opbouwen: `supabase/platform/0001_schema_public.sql` (vervang `{{MERKNAAM}}`), daarna `0002_bootstrap.sql` met ingevulde plaatshouders.
   Vault-secret `mtf_service_role_key` zetten voor de geplande mailtaken.
4. Functies uitrollen (tabel met verify_jwt in PLATFORM-NIEUWE-KLANT.md) en `MTF_*`-secrets zetten.
   Voor een presentatie zonder echte mail/betalingen: `RESEND_API_KEY` en Mollie weglaten.
5. Website: kopie van de site op een eigen branch of eigen Vercel-project (nooit het live project van Mom's), met eigen
   `site-config.js` (Supabase-URL en publishable key van de pilot, modules) en eigen ontwerp (sjablonen in `mtf-templates.js`, kleuren/logo).
6. Menu en voorbeeldgegevens invullen, eigenaarsaccount aanmaken, proefbestelling doen.
7. Klant toevoegen in Platformbeheer (status "pilot").
8. Na de presentatie: pilotproject pauzeren en test weer aanzetten (of plan upgraden als de klant tekent).

## Open punten

- Livegang fase 4 voor Mom's (draaiboek klaar).
- Aanbevolen: repository privé maken; in Supabase de tijdelijke functies `tmp-export` (live) en `tmp-platform-export` (test) verwijderen;
  plan upgraden vóór de eerste betalende klant.
- Modules ook op de server afdwingen; factuuroverzicht per maand in Platformbeheer.
