"""Vervangt merkkleuren in CSS-waarden door var(--mtf-...) uit theme.css.
Alleen in .css-bestanden en <style>-blokken van .html; nooit in selectors of binnen url(...).
Gebruik: python3 apply_theme.py <repo-dir>   (idempotent)"""
import re, sys, glob, os, json

repo = sys.argv[1]
theme = open(os.path.join(repo, "theme.css"), encoding="utf-8").read()
HEX = {v.lower(): k for k, v in re.findall(r"(--mtf-[a-z0-9-]+):(#[0-9a-fA-F]{6});", theme)}
RGB = {tuple(v.split(",")): k for k, v in re.findall(r"(--mtf-[a-z0-9-]+-rgb):(\d+,\d+,\d+);", theme)}

hexre = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])")
rgbare = re.compile(r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,")
urlre = re.compile(r"url\([^)]*\)", re.I)
# declaratie: na { of ; een eigenschap, dan de waarde tot ; } of einde blok
declre = re.compile(r"(?P<pre>[{;]\s*)(?P<prop>--?[A-Za-z][\w-]*|[A-Za-z][\w-]*)(?P<colon>\s*:)(?P<val>[^;{}]*)")

def norm(c):
    c = c.lower()
    return "#" + "".join(ch * 2 for ch in c[1:]) if len(c) == 4 else c

def fix_value(val, stats):
    out, last = [], 0
    for u in urlre.finditer(val):          # url(...) ongemoeid laten
        out.append(fix_plain(val[last:u.start()], stats)); out.append(u.group(0)); last = u.end()
    out.append(fix_plain(val[last:], stats))
    return "".join(out)

def fix_plain(s, stats):
    def h(m):
        name = HEX.get(norm(m.group(0)))
        if not name: return m.group(0)
        stats["hex"] += 1; return f"var({name})"
    s = hexre.sub(h, s)
    def r(m):
        name = RGB.get((m.group(1), m.group(2), m.group(3)))
        if not name: return m.group(0)
        stats["rgba"] += 1; return f"rgba(var({name}),"
    return rgbare.sub(r, s)

def fix_css(css, stats):
    return declre.sub(lambda m: m.group("pre") + m.group("prop") + m.group("colon") + (m.group("val") if m.group("prop").startswith("--mtf-") else fix_value(m.group("val"), stats)), css)

report = {}
for f in sorted(glob.glob(os.path.join(repo, "*.css"))):
    if os.path.basename(f) == "theme.css": continue
    s = open(f, encoding="utf-8").read(); st = {"hex": 0, "rgba": 0}
    n = fix_css(s, st)
    if n != s: open(f, "w", encoding="utf-8").write(n)
    report[os.path.basename(f)] = st
for f in sorted(glob.glob(os.path.join(repo, "*.html"))):
    s = open(f, encoding="utf-8").read(); st = {"hex": 0, "rgba": 0}
    n = re.sub(r"(<style[^>]*>)(.*?)(</style>)", lambda m: m.group(1) + fix_css(m.group(2), st) + m.group(3), s, flags=re.S)
    # inline style="..." attributen: ook declaraties
    n = re.sub(r'(style=")([^"]*)(")', lambda m: m.group(1) + fix_css(";" + m.group(2), st)[1:] + m.group(3), n)
    if n != s: open(f, "w", encoding="utf-8").write(n)
    report[os.path.basename(f)] = st
print(json.dumps({k: v for k, v in report.items() if v["hex"] or v["rgba"]}, ensure_ascii=False))
print("totaal hex", sum(v["hex"] for v in report.values()), "rgba", sum(v["rgba"] for v in report.values()))
