"""Vervangt de vaste lettertype-stacks door var(--mtf-font-...) in font-family en font-shorthand.
Alleen exacte stacks, zodat de terugval per apparaat gelijk blijft. Idempotent."""
import re, sys, glob, os
repo = sys.argv[1]
STACKS = [  # langste eerst
    (r'Georgia\s*,\s*["\']Times New Roman["\']\s*,\s*serif', "var(--mtf-font-heading)"),
    (r'Arial\s*,\s*Helvetica\s*,\s*sans-serif', "var(--mtf-font-body)"),
    (r'Georgia\s*,\s*serif', "var(--mtf-font-serif)"),
    (r'Arial\s*,\s*sans-serif', "var(--mtf-font-body-short)"),
]
declre = re.compile(r"(?P<pre>[{;]\s*)(?P<prop>font-family|font)(?P<colon>\s*:)(?P<val>[^;{}]*)")
def fix(css, st):
    def d(m):
        v = m.group("val")
        for pat, rep in STACKS:
            v, n = re.subn(r"(?<![\w-])" + pat + r"(?![\w-])", rep, v); st[0] += n
        return m.group("pre") + m.group("prop") + m.group("colon") + v
    return declre.sub(d, css)
total = 0
for f in sorted(glob.glob(os.path.join(repo, "*.css"))):
    if os.path.basename(f) == "theme.css": continue
    s = open(f, encoding="utf-8").read(); st = [0]; n = fix(s, st)
    if n != s: open(f, "w", encoding="utf-8").write(n); print(os.path.basename(f), st[0])
    total += st[0]
for f in sorted(glob.glob(os.path.join(repo, "*.html"))):
    s = open(f, encoding="utf-8").read(); st = [0]
    n = re.sub(r"(<style[^>]*>)(.*?)(</style>)", lambda m: m.group(1) + fix(m.group(2), st) + m.group(3), s, flags=re.S)
    n = re.sub(r'(style=")([^"]*)(")', lambda m: m.group(1) + fix(";" + m.group(2), st)[1:] + m.group(3), n)
    if n != s: open(f, "w", encoding="utf-8").write(n); print(os.path.basename(f), st[0])
    total += st[0]
print("totaal", total)
