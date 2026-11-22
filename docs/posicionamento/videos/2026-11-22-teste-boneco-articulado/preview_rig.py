#!/usr/bin/env python3
"""Prévia estática do boneco articulado (PIL): monta as camadas em poses de teste.
Uso: python3 preview_rig.py <pasta_camadas> <saida.png>"""
import sys, os, json
from PIL import Image
D, OUT = sys.argv[1], sys.argv[2]
P = json.load(open(os.path.join(D, "pivos.json")))
W, H = P["size"]; M = 420                      # margem para o braço poder sair da imagem
def load(n):
    im = Image.open(os.path.join(D, n + ".png"))
    c = Image.new("RGBA", (W + 2 * M, H + M), (0, 0, 0, 0)); c.paste(im, (M, M // 2)); return c
L = {n: load(n) for n in ("tronco", "cabeca", "braco", "antebraco")}
def piv(k): x, y = P[k]; return (x + M, y + M // 2)
def rot(img, ang, center):   # ang em graus, sentido horário positivo (como no CSS)
    return img.rotate(-ang, resample=Image.BICUBIC, center=center)
def pose(u=0, f=0, h=0, bg=(225, 232, 245, 255)):
    base = Image.new("RGBA", L["tronco"].size, bg)
    base.alpha_composite(L["tronco"])
    base.alpha_composite(rot(L["cabeca"], h, piv("pescoco")))
    base.alpha_composite(rot(L["braco"], u, piv("ombro")))
    fa = rot(rot(L["antebraco"], f, piv("cotovelo")), u, piv("ombro"))
    base.alpha_composite(fa)
    return base.convert("RGB")
if len(sys.argv) > 3 and sys.argv[3] == "diff":
    import numpy as np
    orig = Image.open(sys.argv[4]).convert("RGBA"); b = Image.new("RGBA", orig.size, (225,232,245,255)); b.alpha_composite(orig)
    r = pose().crop((M, M // 2, M + W, M // 2 + H))
    d = np.abs(np.array(r).astype(int) - np.array(b.convert("RGB")).astype(int)).max(axis=2)
    print("repouso vs original: dif máx", d.max(), "pixels >12:", int((d > 12).sum())); sys.exit()
poses = [(0, 0, 0), (25, 20, -3), (45, 50, 3), (30, -35, 0), (-10, 70, 4)]
cells = [pose(*p).resize(((W + 2 * M) // 3, (H + M) // 3)) for p in poses]
sheet = Image.new("RGB", (cells[0].width * len(cells), cells[0].height))
for i, c in enumerate(cells): sheet.paste(c, (i * c.width, 0))
sheet.save(OUT)
