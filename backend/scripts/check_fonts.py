import sys, glob, os
from fontTools.ttLib import TTFont

TARGET = 0x20B9  # RUPEE SIGN
rows = []
for f in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "assets/fonts/*.ttf")):
    try:
        t = TTFont(f, fontNumber=0, lazy=True)
        cmap = t.getBestCmap()
        has = TARGET in cmap
        # codepoints we need on every face
        need = {0x20B9:"₹", 0x0020:"space", 0x002D:"hyphen", 0x0078:"x",
                0x2014:"emdash", 0x2022:"bullet", 0x20B9:"₹"}
        miss = [g for g in need if g not in cmap]
        name = t["name"].getDebugName(4) or os.path.basename(f)
        lic = None
        for r in t["name"].names:
            if r.nameID == 13:
                lic = r.toUnicode(); break
        rows.append((os.path.basename(f), name, has, miss, lic, len(cmap)))
        t.close()
    except Exception as e:
        rows.append((os.path.basename(f), "ERROR: "+str(e)[:60], None, [], None, 0))

print(f"{'file':<28}{'family':<34}{'₹':<5}{'glyphs':<8} license")
print("-"*118)
bad = 0
for fn, name, has, miss, lic, n in rows:
    flag = "YES" if has else "NO"
    if has is not True: bad += 1
    print(f"{fn:<28}{name[:33]:<34}{flag:<5}{n:<8} {lic}")
    if miss: print(f"{'':<28}  MISSING codepoints: {[hex(g) for g in miss]}")
print()
print("FONTS MISSING RUPEE:", bad)
sys.exit(1 if bad else 0)