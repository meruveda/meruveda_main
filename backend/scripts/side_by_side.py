import sys, pymupdf
from PIL import Image, ImageDraw

def render(path, dpi=150):
    d = pymupdf.open(path)
    pix = d[0].get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

ref = render(sys.argv[1])
gen = render(sys.argv[2])
out = sys.argv[3]
gap, label_h = 24, 34
w = ref.width + gen.width + gap
h = max(ref.height, gen.height) + label_h
canvas = Image.new("RGB", (w, h), "#d9dde3")
canvas.paste(ref, (0, label_h))
canvas.paste(gen, (ref.width + gap, label_h))
dr = ImageDraw.Draw(canvas)
dr.rectangle([0, 0, ref.width, label_h - 1], fill="#334155")
dr.rectangle([ref.width + gap, 0, w, label_h - 1], fill="#7c3aed")
for d_, txt, cx in ((dr, "REFERENCE  (docs/reference/reference-invoice.pdf - MV-139559)", ref.width // 2),
                    (dr, "GENERATED  (docs/samples/06-cod-MV-748371.pdf)", ref.width + gap + gen.width // 2)):
    try:
        bb = d_.textbbox((0, 0), txt)
        d_.text((cx - (bb[2] - bb[0]) // 2, 9), txt, fill="#ffffff")
    except Exception:
        d_.text((cx - 200, 9), txt, fill="#ffffff")
canvas.save(out)
print("wrote", out, canvas.size)