# Fase 2 – thema (voortgang)

## Klaar
- [x] theme.css met 42 namen (--mtf-...) voor de vaakst gebruikte kleuren, waarden exact gelijk aan het huidige ontwerp.
- [x] tools/apply_theme.py: vervangt kleurcodes door var(--mtf-...) in .css-bestanden en <style>/style="" in .html (niet in selectors of url()). Idempotent.
- [x] theme.css gekoppeld in alle 16 pagina's.
- [x] Controle: 32 schermafbeeldingen (16 pagina's × mobiel/desktop), oud vs nieuw. 28 pixel-identiek; 4 mobiel met <100 pixels anti-aliasing aan ronde randen (onzichtbaar).

## Nog te doen
- [x] Lettertypes als variabelen: --mtf-font-heading, --mtf-font-serif, --mtf-font-body, --mtf-font-body-short (exacte stacks behouden). 71 plekken. Pixelcontrole: 28/32 identiek, rest anti-aliasing.
- [x] Kleuren in door scripts aangemaakte stijlen (schedule.js, branch.js, info-dock.js, game-hook.js, admin-stats.js): 31 plekken. Bewust niet: admin-receipts.js (los printvenster) en SVG/canvas-kleuren. Pixelcontrole: 30/32 identiek, 2 met <100 px anti-aliasing.
- [ ] Overgebleven eenmalige kleuren beoordelen (blijven voorlopig letterlijk).
