# Fase 3 – bestelmodule (voortgang)

## Klaar
- [x] 3a. Geen onderschepping van window.fetch meer. mtf-api.js met MTF.fetch (voegt vestiging toe, expliciet per aanroep)
      en MTF.onOrderPlaced/orderPlaced (haak na geplaatste bestelling). Mollie-betaling via die haak.
      Getest: alle 19 pagina-varianten sturen identieke verzoeken; volledige bestelling contant, online en
      online-mislukt gedragen zich identiek aan de vorige versie.

## Volgende stappen
- [ ] 3b. Mandje en prijsberekening uit app.js losmaken als module (MTF.cart), zonder de HTML-opbouw aan te raken.
- [ ] 3c. Gerechtkaarten en mandje tekenen via vervangbare sjablonen (per ontwerp aan te passen).
- [ ] 3d. Vaste gerechtnamen voor het dagmenu (app.js) naar een instelling per gerecht.
- [ ] 3e. Vaste element-ID's (#menuGrid, #cartItems, #form, #bookingCalendar) documenteren als 'contract' voor ontwerpen.
