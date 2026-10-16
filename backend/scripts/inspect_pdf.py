import sys, pymupdf, collections

path = sys.argv[1]
doc = pymupdf.open(path)
print(f"FILE      : {path}")
print(f"pages     : {doc.page_count}")
print(f"pdf version: {doc.metadata.get('format')}")
print(f"producer  : {doc.metadata.get('producer')}")
print(f"creator   : {doc.metadata.get('creator')}")
print(f"title     : {doc.metadata.get('title')}")
print()

for pno in range(doc.page_count):
    page = doc[pno]
    r = page.rect
    print(f"--- page {pno+1}: {r.width:.2f} x {r.height:.2f} pt "
          f"({r.width/72:.2f}in x {r.height/72:.2f}in)  rotation={page.rotation}")
    # page size name
    w_in, h_in = round(r.width/72, 2), round(r.height/72, 2)
    known = {(8.5,11):'US Letter',(8.27,11.69):'A4',(11,8.5):'US Letter landscape',
             (8.25,11.7):'A4 (rounded)',(7.5,10):'US Legal'}
    print(f"           ~{known.get((w_in,h_in),'unknown')}  ({w_in}in x {h_in}in)")
print()

print("=== FONTS ===")
fonts = {}
for pno in range(doc.page_count):
    for f in doc[pno].get_fonts(full=True):
        xref, ext, ftype, basefont, name, enc = f[0], f[1], f[2], f[3], f[4], f[5]
        key = (basefont, ftype, ext)
        fonts.setdefault(key, {"xref": xref, "embedded": ext != "n/a", "ext": ext, "type": ftype})
for (basefont, ftype, ext), meta in sorted(fonts.items()):
    emb = "EMBEDDED" if meta["embedded"] else "not embedded"
    print(f"  {basefont:<45} type={ftype:<12} {emb:<13} fileext={meta['ext']}")
print()

print("=== COLORS USED (text fill colours, by frequency) ===")
colors = collections.Counter()
spans = []
for pno in range(doc.page_count):
    d = doc[pno].get_text("dict")
    for blk in d.get("blocks", []):
        if blk.get("type") != 0:
            continue
        for line in blk.get("lines", []):
            for sp in line.get("spans", []):
                c = sp.get("color", 0)
                hexc = "#%06x" % c
                colors[hexc] += 1
                spans.append(sp)
for c, n in colors.most_common(18):
    r,g,b = int(c[1:3],16), int(c[3:5],16), int(c[5:7],16)
    print(f"  {c}  rgb({r},{g},{b})  x{n}")
print()

print("=== FONT SIZE / FONT USAGE BY TEXT SAMPLE ===")
bysize = collections.defaultdict(list)
for sp in spans:
    bysize[round(sp["size"],1)].append(sp)
for size in sorted(bysize, reverse=True)[:14]:
    sample = bysize[size][0]
    txt = "".join(s["text"] for s in bysize[size])[:58].replace("\n"," ")
    print(f"  {size:>5}pt  x{len(bysize[size]):<4} font={sample['font']:<32} color=#{sample['color']:06x}  {txt!r}")
print()

print("=== IMAGES ===")
for pno in range(doc.page_count):
    for img in doc[pno].get_images(full=True):
        xref = img[0]
        info = doc.extract_image(xref)
        print(f"  page {pno+1}: xref={xref} {info['width']}x{info['height']} ext={info['ext']} bytes={len(info['image'])}")
        for r in doc[pno].get_image_rects(xref):
            print(f"      placed at x={r.x0:.1f} y={r.y0:.1f} w={r.width:.1f} h={r.height:.1f}")
print()

print("=== DRAWINGS (fills/strokes by colour) ===")
fills = collections.Counter(); strokes = collections.Counter()
rects = []
for pno in range(doc.page_count):
    for dr in doc[pno].get_drawings():
        if dr.get("fill") is not None:
            fills["#%02x%02x%02x" % tuple(int(round(c*255)) for c in dr["fill"])] += 1
        if dr.get("color") is not None:
            strokes["#%02x%02x%02x" % tuple(int(round(c*255)) for c in dr["color"])] += 1
        for item in dr.get("items", []):
            if item[0] == "re":
                rects.append((pno, dr["rect"], dr.get("fill"), dr.get("color")))
print("  fills  :", fills.most_common(14))
print("  strokes:", strokes.most_common(14))
print(f"  {len(rects)} rectangles; largest 22 by area:")
for pno, rc, f, s in sorted(rects, key=lambda x: -x[1].get_area())[:22]:
    fh = "#%02x%02x%02x" % tuple(int(round(c*255)) for c in f) if f else "none"
    sh = "#%02x%02x%02x" % tuple(int(round(c*255)) for c in s) if s else "none"
    print(f"    p{pno+1} x={rc.x0:7.1f} y={rc.y0:7.1f} w={rc.width:7.1f} h={rc.height:6.1f} fill={fh} stroke={sh}")
print()

print("=== TEXT WITH POSITIONS (page 1) ===")
d = doc[0].get_text("dict")
out = []
for blk in d.get("blocks", []):
    if blk.get("type") != 0: continue
    for line in blk.get("lines", []):
        for sp in line.get("spans", []):
            t = sp["text"]
            if not t.strip(): continue
            out.append((round(sp["bbox"][0],1), round(sp["bbox"][1],1), round(sp["size"],1),
                        sp["font"], "#%06x"%sp["color"], t))
for x,y,sz,f,c,t in out:
    print(f"  x={x:7.1f} y={y:7.1f} sz={sz:>5} {f:<30} {c} {t!r}")