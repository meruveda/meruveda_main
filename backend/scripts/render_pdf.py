import sys, pymupdf

src, outprefix, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 150
doc = pymupdf.open(src)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=dpi)
    p = f"{outprefix}-{i+1}.png" if doc.page_count > 1 else f"{outprefix}.png"
    pix.save(p)
    print(f"wrote {p}  {pix.width}x{pix.height}  (dpi={dpi})")