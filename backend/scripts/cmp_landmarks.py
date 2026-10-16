import sys, pymupdf

# Compare the LANDMARKS that define the template, ignoring per-order data.
def marks(path):
    d = pymupdf.open(path); p = d[0]
    rows = []
    for blk in p.get_text("dict").get("blocks", []):
        if blk.get("type") != 0: continue
        for line in blk.get("lines", []):
            for sp in line.get("spans", []):
                t = sp["text"].strip()
                if not t: continue
                rows.append((round(sp["bbox"][1],1), round(sp["bbox"][0],1), round(sp["size"],1), t))
    rows.sort()
    # Purple bars are the strongest structural anchors.
    bars = sorted({(round(dr["rect"].y0,1), round(dr["rect"].x0,1), round(dr["rect"].width,1))
                   for dr in p.get_drawings()
                   if dr.get("fill") and abs(dr["fill"][0]-0.298)<0.04 and abs(dr["fill"][1]-0.114)<0.04})
    def find(sub):
        for y,x,s,t in rows:
            if t.startswith(sub): return y,x,s
        return None
    return rows, bars

ref, _ = marks(sys.argv[1])
gen, _ = marks(sys.argv[2])

keys = ["MERUVEDA WELLNESS", "GSTIN", "BILL", "Description", "OTHER", "PAYMENT",
        "Subtotal", "Taxable", "TOTAL", "If you have", "customercare@", "Thank You"]
print(f"{'landmark':<20}{'REF y':>8}{'GEN y':>8}{'delta':>8}   |{'REF x':>7}{'GEN x':>7}")
print("-"*66)
for k in keys:
    r = next((x for x in ref if x[3].startswith(k)), None)
    g = next((x for x in gen if x[3].startswith(k)), None)
    if r and g:
        print(f"{k:<20}{r[0]:>8.1f}{g[0]:>8.1f}{g[0]-r[0]:>8.1f}   |{r[1]:>7.1f}{g[1]:>7.1f}")
    else:
        print(f"{k:<20}{'-':>8}{'-':>8}{'MISSING':>8}")

print()
def bars_of(path):
    d = pymupdf.open(path); p = d[0]
    out = sorted({(round(dr["rect"].y0,1), round(dr["rect"].x0,1), round(dr["rect"].width,1))
                  for dr in p.get_drawings()
                  if dr.get("fill") and abs(dr["fill"][0]-0.298)<0.04 and abs(dr["fill"][1]-0.114)<0.04})
    return out
rb, gb = bars_of(sys.argv[1]), bars_of(sys.argv[2])
print("purple bars  y / x / w")
print("  REF:", rb)
print("  GEN:", gb)