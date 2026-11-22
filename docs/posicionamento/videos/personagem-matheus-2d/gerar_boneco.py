#!/usr/bin/env python3
"""Boneco 2D do Matheus (vetor, articulado) — gera SVG por pose/expressão.

Uso:  python3 gerar_boneco.py <pasta_saida>
Importável:  from gerar_boneco import boneco_svg
             boneco_svg(pose="apontando", expr="feliz")  -> string SVG (600x1000)
Poses/expressões ficam nos dicionários POSES e EXPRS; ângulos são do SVG
(rotate, graus). Para animar: interpolar os ângulos entre dois quadros.
"""
import sys, os, math

# ---- paleta (marca: azul-marinho/azul; vermelho só para o negativo) -------
C = dict(
    line="#0B1A3A",
    skin="#E3AB82", skin_sh="#C98F66", blush="#EE8F80",
    hair="#2A1B16", hair_hi="#4F372B",
    beard="#2E201B", beard_hi="#46332B",
    blazer="#1F3C7C", blazer_sh="#17306A", lapel="#2C509A",
    shirt="#15161C", shirt_hi="#2B2D38",
    pants="#16295A", shoe="#13141A", sole="#4A4C58",
    metal="#C9CED8", watchface="#1B2230",
    white="#FFFFFF", lip="#9A4F47", mouth_in="#4A1F1E", tongue="#D2706B",
)
SW = 4.5  # espessura do contorno
def st(w=SW, col=None):
    return f'stroke="{col or C["line"]}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"'

# ---- expressões ------------------------------------------------------------
EXPRS = {
    #            sobrancelha esq, dir (path)                          olho(rx,ry) olhar(x,y) boca
    "feliz":      dict(bl="M234,176 Q258,158 283,168", br="M317,168 Q342,158 366,176", eye=(21,16), gaze=(0,1),   mouth="sorriso"),
    "neutro":     dict(bl="M234,174 Q258,165 283,170", br="M317,170 Q342,165 366,174", eye=(21,15), gaze=(0,1),   mouth="reta"),
    "surpreso":   dict(bl="M234,160 Q258,142 283,153", br="M317,153 Q342,142 366,160", eye=(22,21), gaze=(0,0),   mouth="O"),
    "preocupado": dict(bl="M234,178 Q260,170 283,156", br="M317,156 Q340,170 366,178", eye=(21,16), gaze=(0,-3),  mouth="ondulada"),
    "pensativo":  dict(bl="M234,178 Q258,173 283,174", br="M317,150 Q342,140 366,158", eye=(21,15), gaze=(8,-7),  mouth="lado"),
    "bravo":      dict(bl="M234,160 Q260,168 283,181", br="M317,181 Q340,168 366,160", eye=(21,13), gaze=(0,2),   mouth="triste"),
}

def mouth_svg(kind):
    L = C["lip"]
    if kind == "sorriso":
        return (f'<path d="M268,283 Q300,291 332,283 Q330,314 300,317 Q270,314 268,283 Z" fill="{C["white"]}" stroke="{C["mouth_in"]}" stroke-width="3.5" stroke-linejoin="round"/>'
                f'<path d="M272,298 Q300,303 328,298" fill="none" stroke="#E4E7EE" stroke-width="2.5"/>'
                f'<path d="M286,311 Q300,303 314,311 Q300,318 286,311 Z" fill="{C["tongue"]}"/>')
    if kind == "reta":
        return (f'<path d="M281,293 Q300,298 319,293" fill="none" stroke="{L}" stroke-width="6" stroke-linecap="round"/>')
    if kind == "O":
        return (f'<ellipse cx="300" cy="300" rx="12" ry="16" fill="{C["mouth_in"]}" stroke="{L}" stroke-width="4"/>'
                f'<ellipse cx="300" cy="308" rx="7" ry="5" fill="{C["tongue"]}"/>')
    if kind == "ondulada":
        return (f'<path d="M278,300 Q289,290 300,299 Q311,308 322,296" fill="none" stroke="{L}" stroke-width="6" stroke-linecap="round"/>')
    if kind == "lado":
        return (f'<path d="M283,299 Q305,297 323,286" fill="none" stroke="{L}" stroke-width="6" stroke-linecap="round"/>')
    if kind == "triste":
        return (f'<path d="M277,303 Q300,285 323,303" fill="none" stroke="{L}" stroke-width="6" stroke-linecap="round"/>')
    return ""

def eye_svg(cx, cy, rx, ry, gx, gy, pid, side):
    cid = f"{pid}clip{side}"
    ir = 10.5 if ry > 14 else 10
    return (
        f'<clipPath id="{cid}"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"/></clipPath>'
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{C["white"]}" stroke="{C["line"]}" stroke-width="3.5"/>'
        f'<g clip-path="url(#{cid})">'
        f'<circle cx="{cx+gx}" cy="{cy+gy}" r="{ir}" fill="#4A2D1F"/>'
        f'<circle cx="{cx+gx}" cy="{cy+gy}" r="5.8" fill="#120C0A"/>'
        f'<circle cx="{cx+gx-3.5}" cy="{cy+gy-4}" r="3" fill="#fff"/>'
        f'</g>'
        # pálpebra superior
        f'<path d="M{cx-rx-1},{cy-1} Q{cx},{cy-ry-6} {cx+rx+1},{cy-1}" fill="none" stroke="{C["line"]}" stroke-width="4.5" stroke-linecap="round"/>'
    )

def head_svg(expr="feliz", pid="h"):
    e = EXPRS[expr]
    rx, ry = e["eye"]; gx, gy = e["gaze"]
    s = []
    # orelhas
    for x in (199, 401):
        s.append(f'<ellipse cx="{x}" cy="218" rx="17" ry="25" fill="{C["skin"]}" {st(4)}/>'
                 f'<path d="M{x-5 if x<300 else x+5},210 Q{x},218 {x-5 if x<300 else x+5},228" fill="none" stroke="{C["skin_sh"]}" stroke-width="4" stroke-linecap="round"/>')
    # rosto
    face = "M202,200 Q200,122 300,112 Q400,122 398,200 Q398,262 362,300 Q336,334 300,336 Q264,334 238,300 Q202,262 202,200 Z"
    s.append(f'<path d="{face}" fill="{C["skin"]}" {st()}/>')
    # bochechas
    s.append(f'<ellipse cx="238" cy="246" rx="17" ry="11" fill="{C["blush"]}" opacity=".55"/>'
             f'<ellipse cx="362" cy="246" rx="17" ry="11" fill="{C["blush"]}" opacity=".55"/>')
    # barba (contorno inferior do rosto + bigode)
    beard = ("M203,226 Q204,278 242,306 Q270,338 300,340 Q330,338 358,306 Q396,278 397,226 "
             "L384,236 Q378,262 352,272 Q338,268 324,258 Q312,252 300,255 Q288,252 276,258 Q262,268 248,272 Q222,262 216,236 Z")
    s.append(f'<path d="{beard}" fill="{C["beard"]}" {st()}/>')
    # brilho de barba (textura simples)
    s.append(f'<path d="M232,288 Q248,306 270,318 M368,288 Q352,306 330,318 M286,330 Q300,334 314,330" fill="none" stroke="{C["beard_hi"]}" stroke-width="4" stroke-linecap="round" opacity=".9"/>')
    s.append(mouth_svg(e["mouth"]))
    # nariz
    s.append(f'<path d="M300,206 Q288,236 289,248 Q300,257 311,248 Q312,236 300,206 Z" fill="{C["skin_sh"]}" opacity=".45"/>'
             f'<path d="M287,248 Q300,258 313,248" fill="none" stroke="{C["line"]}" stroke-width="4" stroke-linecap="round" opacity=".85"/>')
    # olhos
    s.append(eye_svg(258, 202, rx, ry, gx, gy, pid, "L"))
    s.append(eye_svg(342, 202, rx, ry, gx, gy, pid, "R"))
    # sobrancelhas grossas
    s.append(f'<path d="{e["bl"]}" fill="none" stroke="{C["hair"]}" stroke-width="12" stroke-linecap="round"/>'
             f'<path d="{e["br"]}" fill="none" stroke="{C["hair"]}" stroke-width="12" stroke-linecap="round"/>')
    # cabelo (volume no topo, entradas leves, costeletas)
    hair = ("M205,240 L204,204 Q198,166 204,132 Q206,94 238,76 Q250,42 292,38 Q318,22 346,34 Q386,38 394,78 Q404,104 397,134 Q403,166 396,204 L395,240 "
            "L382,240 Q381,214 378,196 Q374,152 350,130 Q330,112 300,118 Q268,112 246,130 Q222,150 220,198 Q219,220 219,240 Z")
    s.append(f'<path d="{hair}" fill="{C["hair"]}" {st()}/>')
    # mechas (brilho)
    s.append(f'<path d="M240,98 Q262,68 296,66 M310,54 Q340,48 364,64 M220,134 Q222,112 238,98 M376,92 Q392,110 390,140" '
             f'fill="none" stroke="{C["hair_hi"]}" stroke-width="6" stroke-linecap="round"/>')
    return f'<g id="head">{"".join(s)}</g>'

# ---- mãos (coordenadas locais do antebraço; eixo +y; polegar em -x) --------
def hand_svg(kind):
    sk, sh = C["skin"], C["skin_sh"]
    if kind == "relaxada":
        return (f'<ellipse cx="-14" cy="104" rx="6.5" ry="13" transform="rotate(12 -14 104)" fill="{sk}" {st(4)}/>'
                f'<path d="M-14,88 Q-17,112 -8,124 Q0,130 8,124 Q17,112 14,88 Z" fill="{sk}" {st(4)}/>'
                f'<path d="M-4,115 L-4,121 M4,116 L4,122" stroke="{sh}" stroke-width="3" stroke-linecap="round"/>')
    if kind == "aponta":
        return (f'<rect x="-5" y="104" width="10" height="42" rx="5" fill="{sk}" {st(4)}/>'
                f'<ellipse cx="-14" cy="100" rx="6.5" ry="10" transform="rotate(14 -14 100)" fill="{sk}" {st(4)}/>'
                f'<path d="M-14,88 Q-16,106 -8,112 Q0,114 8,112 Q16,106 14,88 Z" fill="{sk}" {st(4)}/>'
                f'<circle cx="9" cy="112" r="8" fill="{sk}" {st(3.5)}/><circle cx="8" cy="122" r="7" fill="{sk}" {st(3.5)}/>')
    if kind == "joinha":
        return (f'<rect x="-6.5" y="118" width="13" height="38" rx="6.5" fill="{sk}" {st(4)}/>'
                f'<rect x="-16" y="88" width="32" height="38" rx="13" fill="{sk}" {st(4)}/>'
                f'<path d="M-14,100 L14,100 M-14,109 L14,109 M-12,118 L12,118" stroke="{sh}" stroke-width="3" stroke-linecap="round"/>')
    if kind == "aberta":
        fingers = ""
        for x0, ang, ln in ((-12.5, -13, 20), (-4.2, -4, 25), (4.2, 4, 25), (12.5, 13, 19)):
            fingers += (f'<rect x="{x0-4.6}" y="104" width="9.2" height="{ln+10}" rx="4.6" transform="rotate({ang} {x0} 108)" '
                        f'fill="{sk}" {st(3.5)}/>')
        return (f'<rect x="-19" y="100" width="10.5" height="25" rx="5.2" transform="rotate(54 -14 103)" fill="{sk}" {st(3.5)}/>'
                + fingers +
                f'<rect x="-17" y="86" width="34" height="30" rx="13" fill="{sk}" {st(4)}/>'
                f'<rect x="-10" y="104" width="20" height="10" fill="{sk}"/>')
    if kind == "punho":
        return (f'<rect x="-16" y="88" width="32" height="32" rx="13" fill="{sk}" {st(4)}/>'
                f'<path d="M-14,100 L14,100 M-14,109 L14,109" stroke="{sh}" stroke-width="3" stroke-linecap="round"/>')
    return ""

def arm_svg(side, a1, a2, hand, k=1.0, watch=False, aid="arm"):
    """side: 'E' = lado esquerdo da imagem (mão direita do Matheus); 'D' = lado direito da imagem.
    a1 = ângulo do ombro, a2 = ângulo do cotovelo (rotate do SVG, graus)."""
    sx = 222 if side == "E" else 378
    w = ""
    if watch:
        w = (f'<rect x="-18" y="70" width="36" height="12" rx="4" fill="{C["metal"]}" {st(3)}/>'
             f'<rect x="-10" y="68" width="20" height="15" rx="5" fill="{C["watchface"]}" stroke="{C["metal"]}" stroke-width="3"/>')
    bz = C["blazer"]
    return (
        f'<g id="{aid}" transform="translate({sx},394) rotate({a1})">'
        f'<g transform="scale(1,{k})">'
        f'<circle cx="0" cy="2" r="23" fill="{bz}" {st()}/>'
        f'<circle cx="0" cy="92" r="19.5" fill="{bz}" {st()}/>'
        f'<path d="M-22,2 L22,2 L19.5,92 L-19.5,92 Z" fill="{bz}"/>'
        f'<path d="M-22,2 L-19.5,92 M22,2 L19.5,92" fill="none" {st()}/>'
        f'</g>'
        f'<g transform="translate(0,{92*k}) rotate({a2})">'
        f'<g transform="translate(0,86) scale({-1.4 if side=="E" else 1.4},1.4) translate(0,-86)">{hand_svg(hand)}</g>'
        f'<path d="M-19.5,0 L19.5,0 L16,86 L-16,86 Z" fill="{bz}"/>'
        f'<path d="M-19.5,0 L-16,86 M19.5,0 L16,86" fill="none" {st()}/>'
        f'<rect x="-14" y="82" width="28" height="9" rx="3" fill="{C["shirt"]}" {st(3.5)}/>'
        f'{w}'
        f'</g>'
        f'</g>'
    )

# ---- poses (ângulos do ombro/cotovelo + mão) ---------------------------------
# E = lado esquerdo da imagem (positivo = afasta do corpo); D = lado direito (negativo = afasta)
POSES = {
    "em-pe":      dict(E=(7, -4, "relaxada"),   D=(-7, 4, "relaxada")),
    "apontando":  dict(E=(100, 0, "aponta"),    D=(-8, 4, "relaxada")),
    "joinha":     dict(E=(7, -4, "relaxada"),   D=(-22, -138, "joinha")),
    "explicando": dict(E=(40, 120, "aberta"),   D=(-40, -120, "aberta")),
    "comemorando":dict(E=(150, 10, "aberta"),   D=(-150, -10, "aberta")),
    "dica":       dict(E=(7, -4, "relaxada"),   D=(-30, -112, "aponta")),
}

def boneco_svg(pose="em-pe", expr="feliz", pid="m", bg=None, view="full", vb=None):
    p = POSES[pose]
    arms_over_head = pose in ("pensando",)
    s = []
    # pernas
    s.append(f'<path d="M232,596 L298,596 L292,858 L252,858 Z" fill="{C["pants"]}" {st()}/>')
    s.append(f'<path d="M302,596 L368,596 L348,858 L308,858 Z" fill="{C["pants"]}" {st()}/>')
    s.append(f'<path d="M264,640 L266,830 M336,640 L334,830" stroke="{C["blazer_sh"]}" stroke-width="4" opacity=".7"/>')
    # sapatos (mocassim)
    s.append(f'<path d="M250,852 L294,852 L296,890 Q296,906 280,906 L230,906 Q210,906 212,892 Q214,878 234,874 Q248,872 250,852 Z" fill="{C["shoe"]}" {st()}/>'
             f'<path d="M216,899 L292,899" stroke="{C["sole"]}" stroke-width="5" stroke-linecap="round"/>'
             f'<path d="M350,852 L306,852 L304,890 Q304,906 320,906 L370,906 Q390,906 388,892 Q386,878 366,874 Q352,872 350,852 Z" fill="{C["shoe"]}" {st()}/>'
             f'<path d="M384,899 L308,899" stroke="{C["sole"]}" stroke-width="5" stroke-linecap="round"/>')
    # pescoço
    s.append(f'<path d="M270,300 L330,300 L334,372 L266,372 Z" fill="{C["skin"]}" {st()}/>'
             f'<path d="M270,318 Q300,344 330,318 L330,300 L270,300 Z" fill="{C["skin_sh"]}" opacity=".7"/>')
    # paletó
    s.append(f'<path d="M224,646 Q214,640 212,624 L206,424 Q204,376 252,364 L348,364 Q396,376 394,424 L388,624 Q386,640 376,646 Z" fill="{C["blazer"]}" {st()}/>')
    # camisa preta em V + colarinho
    s.append(f'<path d="M268,364 L332,364 L300,556 Z" fill="{C["shirt"]}" {st(4)}/>')
    s.append(f'<path d="M266,362 L292,376 L274,398 Z M334,362 L308,376 L326,398 Z" fill="{C["shirt_hi"]}" {st(3.5)}/>')
    # lapelas
    s.append(f'<path d="M256,366 L275,366 L306,560 L284,556 L248,404 Q244,376 256,366 Z" fill="{C["lapel"]}" {st(4)}/>'
             f'<path d="M344,366 L325,366 L294,560 L316,556 L352,404 Q356,376 344,366 Z" fill="{C["lapel"]}" {st(4)}/>')
    # fecho, botão, bolso
    s.append(f'<path d="M300,560 L300,642" stroke="{C["line"]}" stroke-width="4" stroke-linecap="round"/>'
             f'<circle cx="292" cy="590" r="6" fill="{C["blazer_sh"]}" {st(3)}/>'
             f'<path d="M232,596 L268,596" stroke="{C["blazer_sh"]}" stroke-width="5" stroke-linecap="round"/>')
    arms = (arm_svg("E", *p["E"][:3], k=(p["E"][3] if len(p["E"])>3 else 1.0), aid="arm-e") + arm_svg("D", *p["D"][:3], k=(p["D"][3] if len(p["D"])>3 else 1.0), watch=True, aid="arm-d"))
    if arms_over_head:
        s.append(head_svg(expr, pid)); s.append(arms)
    else:
        s.append(arms); s.append(head_svg(expr, pid))
    vb = vb or ("-120 20 840 900" if view == "full" else "170 30 260 340")
    bgr = f'<rect x="0" y="0" width="600" height="1000" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{840 if view == 'full' else 260}" height="{900 if view == 'full' else 340}">'
            f'{bgr}<g id="matheus-2d">{"".join(s)}</g></svg>')

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for pose in POSES:
        open(os.path.join(out, f"matheus-{pose}.svg"), "w").write(boneco_svg(pose, "feliz"))
    for ex in EXPRS:
        open(os.path.join(out, f"rosto-{ex}.svg"), "w").write(boneco_svg("em-pe", ex, view="head"))
    print("ok", out)
