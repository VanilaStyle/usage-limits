import numpy as np, math, os, sys
from PIL import Image, ImageOps, ImageFilter
src, out = sys.argv[1], sys.argv[2]
im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
W, H = im.size
k = W / 1125.0                      # coordinates measured on 1125-wide preview
y0 = 250
crop = im.crop((0, int(y0*k), W, int(y0*k) + W)).resize((1600, 1600), Image.LANCZOS)
base = np.asarray(crop).astype(np.float32) / 255.0
S = 1600 / 1125.0
yy, xx = np.mgrid[0:1600, 0:1600].astype(np.float32)
# lamp glow
lx, ly = 160*S, (455-y0)*S
lamp = np.exp(-((xx-lx)**2 + (yy-ly)**2) / (2*(150*S)**2))[..., None] * np.array([1.0, .78, .45], np.float32)
# watermelon mask (soft ellipse)
mx, my, rx, ry = 567*S, (1150-y0)*S, 192*S, 178*S
d = ((xx-mx)/rx)**2 + ((yy-my)/ry)**2
mel = np.clip((1.0 - d) / 0.08, 0, 1)[..., None]
os.makedirs("frames", exist_ok=True)
FPS, DUR = 30, 6
N = FPS * DUR
for i in range(N):
    t = i / N
    ph = 2*math.pi*t
    img = base.copy()
    # warm lamp breathing
    img = img + lamp * (0.06 + 0.05*math.sin(ph*2))
    # shine sweep over melon (once per loop, in second half)
    s = (t - 0.45) / 0.35
    if 0 <= s <= 1:
        pos = -1.3 + 2.6*s
        band = np.exp(-(((xx-mx)/rx + (yy-my)/ry*0.6 - pos)**2) / (2*0.12**2))[..., None]
        img = img + band * mel * 0.22 * math.sin(math.pi*s)
    img = np.clip(img, 0, 1)
    fr = Image.fromarray((img*255).astype(np.uint8))
    # gentle zoom + drift, seamless
    z = 1.0 + 0.035*(1 - math.cos(ph))/2
    cw = 1600 / (1.04 * z)
    cx = 800 + 12*math.sin(ph)
    cy = 820 + 8*math.sin(ph*2)
    fr = fr.resize((800, 800), Image.LANCZOS, box=(cx-cw/2, cy-cw/2, cx+cw/2, cy+cw/2))
    fr.save(f"frames/{i:04d}.png")
