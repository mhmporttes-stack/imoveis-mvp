#!/usr/bin/env python3
"""Corta uma pose realista do dono em camadas articuláveis (marionete 2D).
Camadas (todas do tamanho da imagem original, RGBA):  tronco, cabeça, braço (ombro->cotovelo), antebraço+mão.
Regra das emendas: cada peça invade ~20 px a vizinha (com borda suave) e o tronco mantém os pixels dessa
faixa, então em repouso a montagem é idêntica à foto e, ao girar, a emenda não aparece.
Uso: python3 build_rig.py <imagem.png> <pasta_saida>
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert("RGBA")
W, H = im.size
A = np.array(im.getchannel("A")).astype(np.float32) / 255.0

def poly_mask(pts, blur=0.0):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    if blur: m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.array(m).astype(np.float32) / 255.0

def save(name, alpha):
    arr = np.array(im).copy()
    arr[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(arr, "RGBA").save(os.path.join(OUT, name + ".png"), optimize=True)

# ---- geometria (coordenadas da imagem 1080x1350 da pose "explicando") ----
# antebraço + mão: tudo à esquerda da linha do cotovelo (454,836)-(426,1014)
F_core = [(470,846),(376,838),(350,780),(60,740),(0,740),(0,1020),(380,1020),(420,968),(462,950)]
F_ext  = [(480,838),(376,838),(350,780),(60,740),(0,740),(0,1030),(380,1030),(420,978),(470,958),(482,900)]       # +invade o tronco
# braço (ombro->cotovelo): fora da linha do flanco do tronco
U_core = [(380,470),(515,470),(515,497),(500,560),(494,620),(490,700),(480,800),(472,852),(380,852)]
U_ext  = [(380,470),(528,470),(528,497),(513,560),(507,620),(503,700),(493,800),(484,862),(380,862)]       # +invade o tronco
# cabeça: acima do pescoço, sem a gola direita; rampa de 440 a 470
H_poly = [(460,0),(820,0),(820,405),(752,405),(748,440),(745,470),(555,470),(552,440),(460,440)]

# máscaras
mF_core = poly_mask(F_core, 1.2); mF_ext = poly_mask(F_ext, 3.5)
mU_core = poly_mask(U_core, 1.2); mU_ext = poly_mask(U_ext, 3.0)
mH = poly_mask(H_poly, 1.4)
yy = np.arange(H, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
ramp = np.clip((470.0 - yy) / 30.0, 0, 1)            # 1 até y=440, 0 em y=470
head_alpha = A * mH * ramp
head_core = poly_mask([(460,0),(820,0),(820,405),(752,405),(748,440),(460,440)], 1.0)  # tronco não tem isso

fore_alpha = A * mF_ext
upper_alpha = A * mU_ext * (1 - np.clip(mF_core * 0.0, 0, 1))
torso_alpha = A * (1 - np.clip(mF_core + mU_core, 0, 1)) * (1 - head_core)

save("tronco", torso_alpha); save("cabeca", head_alpha); save("braco", upper_alpha); save("antebraco", fore_alpha)
json.dump(dict(size=[W, H], ombro=[485, 565], cotovelo=[458, 920], pescoco=[640, 452]), open(os.path.join(OUT, "pivos.json"), "w"))
print("ok", W, H)
