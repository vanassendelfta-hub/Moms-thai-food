# Elementcontract voor een eigen klantontwerp

Het bestelplatform (app.js, schedule.js, mtf-cart.js en de rest) zoekt in de pagina naar vaste elementen.
Een restaurant mag de hele vormgeving vervangen: HTML-opbouw, CSS, lettertypes en sjablonen.
**Deze id's en veldnamen moeten wel blijven bestaan**, anders werkt bestellen niet.

Verplicht = de pagina werkt niet zonder. Optioneel = de functie verdwijnt stil als het element ontbreekt.

## Laadvolgorde van de scripts

```
site-config.js → mtf-api.js → branch.js → order-rules.js → mtf-cart.js → mtf-templates.js
→ [eigen sjablonen, optioneel] → app.js → schedule.js → promotions.js → welkom10.js → [campagnes.js, menu-cinematic.js, …]
```

Eigen sjablonen staan in een eigen script direct na `mtf-templates.js` (zie onder).

## Winkelmandje (lade)

| Element | Verplicht | Wat het doet |
|---|---|---|
| `#cartBtn` | ja | knop die het mandje opent |
| `#count` (in `#cartBtn`) | ja | aantal stuks in het mandje |
| `#drawer` | ja | het mandje zelf; krijgt klasse `open` |
| `#backdrop` | ja | achtergrond achter het mandje; krijgt `open` |
| `#close` | ja | knop om het mandje te sluiten |
| `#cartItems` | ja | hier komen de mandjesregels (sjabloon `cartLine` / `cartEmpty`) |
| `#checkoutJump` | ja | knop "naar afrekenen" |
| `#checkout` | ja | het afrekengedeelte |
| `#toast` | ja | korte meldingen; krijgt klasse `show` |

## Menukaart

| Element | Verplicht | Wat het doet |
|---|---|---|
| `#menuGrid` | op menu- en homepagina | gerechten (sjablonen `dishCard`, `category`, `favoriteCard`, `menuEmpty`) |
| `#pills` | bij `#menuGrid` op de menupagina | categorieknoppen (sjabloon `categoryPill`) |
| `#search` | optioneel | zoekveld |
| `[data-home]` | optioneel | markeert de homepagina: dan toont `#menuGrid` alleen de favorieten |
| `#dishAddonDialog` | wordt zelf aangemaakt | keuzevenster voor bijgerecht, extra en pittigheid |

## Bestelformulier `#form`

Velden (attribuut `name`), allemaal binnen `#form`:

| Veld | Verplicht | Opmerking |
|---|---|---|
| `name`, `email`, `phone` | ja | |
| `method` | ja | radioknoppen met waarde `Bezorgen` en `Afhalen` |
| `address`, `city` | ja (bij bezorgen) | staan in `#addressFields`, dat bij afhalen verborgen wordt |
| `date`, `time` | ja | worden door de agenda gevuld; mogen verborgen zijn |
| `payment` | ja | keuzelijst; de online optie wordt door schedule.js toegevoegd |
| `notes` | optioneel | |
| `coupon_code` | optioneel | met `#couponCode`, `#couponHint`, `#couponDiscountRow`, `#couponDiscount` |
| `marketing_consent` | optioneel | voor het WELKOM10-formulier |

Overige elementen bij het formulier:

| Element | Verplicht | Wat het doet |
|---|---|---|
| `#submitOrder` | ja | bestelknop; wordt uitgeschakeld zolang bestellen niet kan |
| `#cartSubtotal`, `#deliveryLabel`, `#deliveryFee`, `#total` | ja | prijsoverzicht |
| `#deliveryHint` | ja | uitleg over bezorgkosten of de reden waarom bestellen nog niet kan; krijgt klasse `checkout-error` |
| `#scheduleHint` | ja | uitleg bij het kiezen van dag en tijd |
| `#bookingCalendar`, `#bookingSlots` | ja | agenda en tijdvakken (opgebouwd door schedule.js) |
| `#calendarPrev`, `#calendarNext` | wordt zelf aangemaakt | bladeren in de agenda |
| `#shopClosed`, `#shopClosedMessage` | ja | melding als online bestellen dicht staat (`#shopClosed` krijgt `hidden`) |

## Vaste knopattributen

Deze attributen koppelen knoppen aan het platform. Gebruik ze ook in eigen sjablonen:

| Attribuut | Betekenis |
|---|---|
| `data-add="<gerecht-id>"` | gerecht toevoegen |
| `data-plus="<regelnummer>"` | één meer van deze mandjesregel |
| `data-minus="<regelnummer>"` | één minder |
| `data-remove="<regelnummer>"` | regel verwijderen |
| `data-cat="<categorie>"` | categorie kiezen (standaard menukaart) |
| `data-bookdate`, `data-booktime` | dag en tijdvak in de agenda (door schedule.js) |

## Aanbiedingen en acties (optioneel)

Ontbreken ze, dan verschijnt de actie gewoon niet.

- promotions.js: `#couponOffer`, `#couponSignup`, `#couponResult`, `#confirmCoupon`, `#couponTerms`, `#signupSection`, `#signupMessage`, `#floatingCouponTitle`, `#floatingCouponTerms`, `#floatingSignupMessage`, `#reviewsTitle`
- welkom10.js en campagnes.js: `#welkomForm`, `#welkomMessage`, `#welcomePeriod`
- home-deals.js: `#dealsGrid`, `#combiDeals`
- menu-cinematic.js: alleen bij `<body class="mc">`; gebruikt `#mcHero`, `#mcList`, `#mcSearchBtn`, `#mcPromoSlot`

## Sjablonen

`mtf-templates.js` bevat de standaardweergave. Een eigen ontwerp vervangt alleen wat anders moet:

```html
<script src="/mtf-templates.js"></script>
<script src="/klant/sjablonen.js"></script>   <!-- eigen sjablonen -->
<script src="app.js"></script>
```

```js
MTF.templates.use({
  dishCard:(x,h)=>`<div class="kaart">
     <img src="${h.esc(x.image_url||h.photo(x))}" alt="">
     <h3>${h.esc(x.name)}</h3><span>${h.euro(x.price)}</span>
     <button type="button" data-add="${h.esc(x.id)}">Bestellen</button></div>`
});
```

| Sjabloon | Argumenten | Toont |
|---|---|---|
| `dishCard` | gerecht, h | één gerecht op de menukaart |
| `favoriteCard` | gerecht, h | één favoriet op de homepagina (`h.shopOpen` voor uitgeschakelde knop) |
| `category` | naam, notitie, kaarten-HTML, h | categorieblok |
| `categoryPill` | naam, actief, h | categorieknop |
| `menuEmpty` | h | geen gerechten gevonden |
| `cartLine` | regel, regelnummer, h | één mandjesregel |
| `cartEmpty` | h | leeg mandje |

`h` = `{esc, euro, photo, shopOpen}`. Zet tekst uit de database altijd door `h.esc`. Een onbekende sjabloonnaam geeft direct een foutmelding.

Een ontwerp dat de hele menukaart anders opbouwt (zoals `menu-cinematic.js`) mag `renderMenu` vervangen. Ook dan gebruiken de knoppen `data-add` en roepen ze `add(id)` aan.

## Rekenen en bestellen: niet in het ontwerp

Prijzen, bezorgkosten, minimumbedrag, openingstijden en het mandje komen uit `MTFOrderRules` en `MTF.cart`.
Een ontwerp rekent nooit zelf: gebruik `MTF.cart.quote(cart, methode)` als een eigen weergave een bedrag nodig heeft.
De server controleert elke bestelling opnieuw met dezelfde regels.
