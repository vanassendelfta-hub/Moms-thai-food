"""Zet merkkleuren om in CSS-tekst die scripts in de pagina zetten (style-elementen, cssText).
Alleen in declaraties 'eigenschap:waarde' na { of ; waarvan de waarde niet met een quote begint
(dus geen JS-objecten, SVG-attributen of canvas-kleuren). Slaat admin-receipts.js over (los printvenster)."""
import re, sys, glob, os
repo = sys.argv[1]; os.environ["MTF_REPO"] = repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_theme_core import fix_value, declre
SKIP = {"admin-receipts.js"}
total = 0
for f in sorted(glob.glob(os.path.join(repo, "*.js"))):
    if os.path.basename(f) in SKIP or os.path.basename(f) == "site-config.js": continue
    s = open(f, encoding="utf-8").read(); st = {"hex": 0, "rgba": 0}
    def d(m):
        v = m.group("val")
        if v.lstrip()[:1] in "'\"`" or m.group("prop").startswith("--mtf-"): return m.group(0)
        return m.group("pre") + m.group("prop") + m.group("colon") + fix_value(v, st)
    n = declre.sub(d, s)
    if n != s:
        open(f, "w", encoding="utf-8").write(n); print(os.path.basename(f), st)
    total += st["hex"] + st["rgba"]
print("totaal", total)
