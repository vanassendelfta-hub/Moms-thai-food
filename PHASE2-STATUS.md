# Fase 2 – thema (voortgang)

## Klaar
- [x] theme.css met 42 namen (--mtf-...) voor de vaakst gebruikte kleuren, waarden exact gelijk aan het huidige ontwerp.
- [x] tools/apply_theme.py: vervangt kleurcodes door var(--mtf-...) in .css-bestanden en <style>/style="" in .html (niet in selectors of url()). Idempotent.
- [x] theme.css gekoppeld in alle 16 pagina's.
- [x] Controle: 32 schermafbeeldingen (16 pagina's × mobiel/desktop), oud vs nieuw. 28 pixel-identiek; 4 mobiel met <100 pixels anti-aliasing aan ronde randen (onzichtbaar).

## Nog te doen
- [x] Lettertypes als variabelen: --mtf-font-heading, --mtf-font-serif, --mtf-font-body, --mtf-font-body-short (exacte stacks behouden). 71 plekken. Pixelcontrole: 28/32 identiek, rest anti-aliasing.
- [ ] Kleuren in JS-gegenereerde stijlen (schedule.js, promotions.js, branch.js e.d.) laten verwijzen naar de variabelen.
- [ ] Overgebleven eenmalige kleuren beoordelen (blijven voorlopig letterlijk).
