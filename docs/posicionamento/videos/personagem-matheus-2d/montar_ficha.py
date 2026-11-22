#!/usr/bin/env python3
"""Monta a ficha do personagem (HTML -> PNG via render.js). Uso: python3 montar_ficha.py <pasta>"""
import os, sys, subprocess
from gerar_boneco import boneco_svg, POSES, EXPRS, C

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(os.path.join(out, "svg"), exist_ok=True)
for pose in POSES:
    open(os.path.join(out, "svg", f"matheus-{pose}.svg"), "w").write(boneco_svg(pose, "feliz", pid=pose))
for ex in EXPRS:
    open(os.path.join(out, "svg", f"rosto-{ex}.svg"), "w").write(boneco_svg("em-pe", ex, pid="r"+ex, view="head"))

def pose_card(pose, label):
    return f'<div class="card pose"><div class="fig">{boneco_svg(pose, "feliz", pid="p"+pose, vb="-20 20 640 900")}</div><b>{label}</b></div>'
def face_card(ex, label):
    return f'<div class="card face"><div class="fig">{boneco_svg("em-pe", ex, pid="f"+ex, view="head")}</div><b>{label}</b></div>'

faces = [("feliz","feliz"),("neutro","neutro"),("surpreso","surpreso"),("preocupado","preocupado"),("pensativo","pensativo"),("bravo","bravo / reprovado")]
poses = [("apontando","apontando"),("joinha","joinha"),("explicando","explicando"),("comemorando","comemorando"),("dica","dica / atenção")]
chips = [("Terno",C["blazer"]),("Lapela",C["lapel"]),("Camisa",C["shirt"]),("Cabelo",C["hair"]),("Barba",C["beard"]),("Pele",C["skin"]),("Contorno",C["line"])]

html = f"""<!doctype html><meta charset="utf-8"><style>
*{{box-sizing:border-box}} body{{margin:0;width:1800px;height:1580px;font-family:Inter,Arial,sans-serif;color:#0B1A3A;
background:radial-gradient(1200px 900px at 50% 30%,#FFFFFF 0%,#F7F9FD 35%,#EAF0FA 70%,#DCE5F4 100%);padding:48px 56px;position:relative}}
h1{{margin:0;font-size:44px;letter-spacing:-.5px}} .sub{{margin:6px 0 0;font-size:20px;color:#3A4A66}}
.hero{{position:absolute;left:56px;top:170px;width:560px;height:970px}} .hero svg{{width:100%;height:100%}}
.right{{position:absolute;left:680px;top:150px;width:1064px}}
h2{{margin:0 0 12px;font-size:18px;letter-spacing:2px;text-transform:uppercase;color:#1F5FD6}}
.grid{{display:grid;gap:16px}} .faces{{grid-template-columns:repeat(6,1fr)}} .poses{{grid-template-columns:repeat(3,1fr)}}
.card{{background:#ffffffcc;border:2px solid #0B1A3A14;border-radius:18px;padding:10px 8px 12px;text-align:center}}
.card b{{display:block;margin-top:6px;font-size:15px;color:#3A4A66;font-weight:600}}
.face .fig{{height:150px}} .face svg{{width:100%;height:100%}}
.pose .fig{{height:470px}} .pose svg{{width:100%;height:100%}}
.chips{{display:flex;flex-wrap:wrap;gap:12px 18px;margin-top:8px;justify-content:center}} .note{{font-size:15px;color:#3A4A66;line-height:1.5;margin-top:14px;text-align:left;padding:0 14px}} .pal{{display:flex;flex-direction:column;justify-content:center;height:100%}} .chip{{display:flex;align-items:center;gap:8px;font-size:14px;color:#3A4A66}}
.chip i{{width:26px;height:26px;border-radius:50%;border:2px solid #0B1A3A;display:inline-block}}
</style>
<h1>Matheus 2D — ficha do personagem</h1>
<p class="sub">Boneco vetorial articulado (SVG) · pronto para animar · paleta da marca · fundo claro</p>
<div class="hero">{boneco_svg("em-pe","feliz",pid="hero", vb="40 20 520 900")}</div>
<div class="right">
  <h2>Expressões</h2><div class="grid faces">{''.join(face_card(a,b) for a,b in faces)}</div>
  <h2 style="margin-top:26px">Poses</h2><div class="grid poses">{''.join(pose_card(a,b) for a,b in poses)}
    <div class="card pal"><b style="margin:0 0 10px;font-size:16px;color:#0B1A3A">Paleta e traços</b><div class="chips">{''.join(f'<div class="chip"><i style="background:{c}"></i>{n}</div>' for n,c in chips)}</div>
    <div class="note">• Cabelo escuro com topete e barba cheia (das suas fotos)<br>• Terno azul-marinho + camisa preta + relógio<br>• Braços e cotovelos articulados: dá para animar<br>• Vermelho só em palavra negativa (regra da marca)</div></div></div>
  </div>"""
open(os.path.join(out, "ficha.html"), "w").write(html)
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run(["node", os.path.join(here, "render.js"), os.path.join(out, "ficha.html"), os.path.join(out, "ficha-personagem.png"), "1800", "1580", "1"], check=True)
os.remove(os.path.join(out, "ficha.html"))
print("ok")
