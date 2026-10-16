import sys, pymupdf

doc = pymupdf.open(sys.argv[1])
page = doc[0]
PTS = 72.0
print("=== KEY TEXT (top-down y, as painted) ===")
d = page.get_text("dict")
rows = []
for blk in d.get("blocks", []):
    if blk.get("type") != 0: continue
    for line in blk.get("lines", []):
        for sp in line.get("spans", []):
            t = sp["text"]
            if not t.strip(): continue
            rows.append((round(sp["bbox"][1],1), round(sp["bbox"][0],1),
                         round(sp["bbox"][2],1), round(sp["size"],1), sp["font"],
                         "#%06x"%sp["color"], t))
for y,x0,x1,sz,f,c,t in sorted(rows):
    print(f" y={y:6.1f} x={x0:6.1f}..{x1:6.1f} w={x1-x0:6.1f} {sz:>5}pt {f:<26} {c} {t!r}")

print()
print("=== ALL RECTS (top-down) ===")
rects = []
for dr in page.get_drawings():
    for item in dr.get("items", []):
        if item[0] == "re":
            r = item[1]
            f = "#%02x%02x%02x" % tuple(int(round(c*255)) for c in dr["fill"]) if dr.get("fill") else "-"
            s = "#%02x%02x%02x" % tuple(int(round(c*255)) for c in dr["color"]) if dr.get("color") else "-"
            rects.append((round(r.y0,1), round(r.x0,1), round(r.width,1), round(r.height,1), f, s))
for y,x,w,h,f,s in sorted(rects):
    print(f" y={y:7.1f} x={x:7.1f} w={w:7.1f} h={h:6.1f} fill={f} stroke={s}  (x1={x+w:.1f} y1={y+h:.1f})")

print()
print("=== TABLE COLUMN BOUNDARIES (from vertical separators in header band) ===")
# purple header band spans y=372..393.8 ; find its vertical divider x positions
band = [r for r in rects if abs(r[0]-372.0) < 2.5]
if band:
    ys = band[0][0]
    band_rects = sorted([r for r in rects if abs(r[0]-ys)<2.5], key=lambda r: r[1])
    print("header band y=%.1f rects:" % ys)
    for r in band_rects:
        print(f"   x={r[1]:7.1f} w={r[2]:7.1f}  x1={r[1]+r[2]:7.1f}")

print()
print("=== IMAGES ===")
for img in page.get_images(full=True):
    for r in page.get_image_rects(img[0]):
        print(f"  logo x={r.x0:.1f} y={r.y0:.1f} w={r.width:.1f} h={r.height:.1f}")

print()
print("=== MARGINS / CONTENT EXTENTS ===")
allspans = rows
if allspans:
    print(f"  text min x = {min(r[1] for r in allspans):.1f}")
    print(f"  text max x = {max(r[2] for r in allspans):.1f}")
    print(f"  text min y = {min(r[0] for r in allspans):.1f}")
    print(f"  text max y = {max(r[0] for r in allspans):.1f}")
xr = [r for r in rects if r[4] != '-' or r[5] != '-']
if xr:
    print(f"  rect min x = {min(r[1] for r in xr):.1f}   rect max x = {max(r[1]+r[2] for r in xr):.1f}")