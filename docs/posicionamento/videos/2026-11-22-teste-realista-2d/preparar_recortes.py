#!/usr/bin/env python3
"""Prepara os recortes realistas (biblioteca do dono) para a cena: normaliza o alfa, corta na caixa e reduz.
Uso: python3 preparar_recortes.py <pasta_saida> pose1 pose2 ..."""
import sys, os
import numpy as np
from PIL import Image
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "boneco-3d", "realista-hd") + os.sep
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for name in sys.argv[2:]:
    im = Image.open(SRC + name + ".png").convert("RGBA")
    a = np.array(im.getchannel("A")).astype(float)
    mx = a.max()
    if mx < 250:  # alguns recortes nunca chegam a 255: normaliza
        a = np.clip(a * 255.0 / mx, 0, 255)
    im.putalpha(Image.fromarray(a.astype("uint8")))
    bb = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(bb)
    h = 1150; w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS)
    im.save(os.path.join(out, name + ".png"), optimize=True)
    print(name, im.size, "bbox_orig", bb)
