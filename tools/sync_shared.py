"""Kopieert gedeelde serverbestanden uit supabase/functions/_shared naar elke functie die ze importeert.

Supabase rolt elke functie los uit; daarom staat in elke functiemap een kopie.
Pas alleen _shared/ aan en draai dan:  python3 tools/sync_shared.py
Met --check: alleen controleren (exitcode 1 als een kopie afwijkt).
"""
import os, re, sys, shutil
root = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'functions')
shared = os.path.join(root, '_shared')
names = sorted(os.listdir(shared))
check = '--check' in sys.argv
bad = 0
for fn in sorted(os.listdir(root)):
    d = os.path.join(root, fn)
    if fn.startswith('_') or not os.path.isdir(d):
        continue
    needed, todo = set(), [f for f in os.listdir(d) if f.endswith(('.ts', '.js'))]
    seen = set()
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        src = os.path.join(shared, f) if f in names else os.path.join(d, f)
        if not os.path.exists(src):
            continue
        for m in re.findall(r'from\s+["\']\./([\w.-]+)["\']|import\s+["\']\./([\w.-]+)["\']', open(src, encoding='utf-8').read()):
            dep = m[0] or m[1]
            if dep in names:
                needed.add(dep); todo.append(dep)
    for n in sorted(needed):
        a, b = os.path.join(shared, n), os.path.join(d, n)
        same = os.path.exists(b) and open(a, 'rb').read() == open(b, 'rb').read()
        if not same:
            bad += 1
            print(('AFWIJKEND ' if check else 'bijgewerkt ') + fn + '/' + n)
            if not check:
                shutil.copyfile(a, b)
print('klaar' if not bad else f'{bad} bestand(en) ' + ('wijken af' if check else 'bijgewerkt'))
sys.exit(1 if check and bad else 0)
