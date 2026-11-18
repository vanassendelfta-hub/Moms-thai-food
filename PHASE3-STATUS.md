# Fase 3 – bestelmodule (voortgang)

## Klaar
- [x] 3a. Geen onderschepping van window.fetch meer. mtf-api.js met MTF.fetch (voegt vestiging toe, expliciet per aanroep)
      en MTF.onOrderPlaced/orderPlaced (haak na geplaatste bestelling). Mollie-betaling via die haak.
      Getest: alle 19 pagina-varianten sturen identieke verzoeken; volledige bestelling contant, online en
      online-mislukt gedragen zich identiek aan de vorige versie.

## Volgende stappen
- [x] 3b. Mandje en prijsberekening uit app.js losmaken als module (MTF.cart), zonder de HTML-opbouw aan te raken.
  - `mtf-cart.js` (na order-rules.js, vóór app.js): key, line, count, subtotalCents, canIncrease, items, load, save, quote.
  - Bezorgregels staan één keer in `MTFOrderRules.delivery` (minimum € 20, gratis vanaf € 35, anders € 2,50) en `deliveryFeeCents()`; app.js en de couponcode rekenen niet meer zelf.
  - Oude tekst "uiterlijk om 16:00" in app.js vervangen door de echte besteltijd van die dag.
  - Getest oud tegen nieuw: mandjescenario (varianten, plus/min, max 50, bezorgen/afhalen rond € 20 en € 35, coupon, herladen, bestellen) in beide locaties gelijk; 500.025 prijsgevallen gelijk; paginaverzoeken, bestelflow en screenshots gelijk.
  - `supabase/functions/place-order/order-rules.js` bijgewerkt (gedrag gelijk); meenemen bij de volgende uitrol van place-order.
- [x] 3c. Vervangbare sjablonen voor gerechtkaarten en mandje: `mtf-templates.js` (dishCard, favoriteCard, category, categoryPill, menuEmpty, cartLine, cartEmpty) met `MTF.templates.use({...})`.
  - Standaardsjablonen geven byte-voor-byte dezelfde HTML (home, filmische menukaart, standaard menukaart, mandje; open en dicht; speciale tekens).
  - Proef met eigen sjablonen: eigen kaarten, toevoegen, plus en totaal werken; onbekende sjabloonnaam geeft een foutmelding.
- [x] 3d. Dagmenu-filter met vaste gerechtnamen bleek dode code (geen pagina heeft [data-day]) en is verwijderd.
      Regels voor standaardfoto's (photoFor in app.js én admin-extra.js) staan nu één keer in site-config.js
      (SITE_CONFIG.fallbackPhoto). Getest: 588 gevallen identiek; pagina's en verzoeken ongewijzigd.
- [x] 3e. Elementcontract vastgelegd in `ELEMENT-CONTRACT.md` (id's, veldnamen, knopattributen, laadvolgorde, sjablonen). Niet gepubliceerd op de website.
