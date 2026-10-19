"""Converte as lâminas renderizadas (PNG 2160x2700, --escala 2) para o formato que o Instagram mantém sem
recomprimir de novo: JPG 1080x1350, qualidade 95, sem subamostragem de cor (texto colorido nítido).
Uso: python3 .claude/design/tools/exportar-instagram.py <pasta-do-carrossel>
Saída: <pasta>/instagram/lamina-NN.jpg  (dono, 2026-10-19: qualidade caindo ao postar PNG grande)."""
import sys, glob, os
from PIL import Image
pasta = sys.argv[1]
saida = os.path.join(pasta, "instagram"); os.makedirs(saida, exist_ok=True)
for f in sorted(glob.glob(os.path.join(pasta, "lamina-*.png"))):
    im = Image.open(f).convert("RGB")
    if im.size != (1080, 1350):
        im = im.resize((1080, 1350), Image.LANCZOS)
    dst = os.path.join(saida, os.path.basename(f)[:-4] + ".jpg")
    im.save(dst, "JPEG", quality=95, subsampling=0, optimize=True, progressive=True)
    print(dst, os.path.getsize(dst) // 1024, "KB")
