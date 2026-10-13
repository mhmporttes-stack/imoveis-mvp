# Reels vertical 1080x1920 do Recanto Verde (foco: quem paga aluguel) só com as 7 fotos reais do CRM, tratadas
# (upscale/nitidez, sem mudar o imóvel). Evolução sobre o Terras de SP: gancho cinético com "ALUGUEL?" riscado,
# rolagem de feed, cortina azul diagonal, carimbo "pronta p/ morar", tela dividida dos 2 quartos, checklist e
# fecho com Matheus segurando a chave. Sem áudio. Quadros gerados sob demanda (não guarda o vídeo na memória).
#
# Uso: python3 montar-video.py <pasta-fotos-tratadas> <pasta-camadas> <saida.mp4> [--previa]
#      python3 montar-video.py <fotos> <camadas> <pasta-png> --quadros 1.2,4,...   (prévia em PNG)
import cv2, numpy as np, subprocess, sys, math
FOT, OV, OUT = sys.argv[1:4]; ARGS = sys.argv[4:]
FPS = 30; W, H = 1080, 1920; TR = 0.4
foto = [None] + [cv2.imread(f'{FOT}/foto{i}.jpg') for i in range(1, 8)]   # 1 sala, 2 sala/jantar, 3 sala integrada, 4 cozinha, 5 quarto 1, 6 quarto 2, 7 quintal/lavanderia
ov = [None] + [cv2.imread(f'{OV}/lamina-{i:02d}.png', cv2.IMREAD_UNCHANGED) for i in range(1, 30)]
yy, xx = np.mgrid[0:H, 0:W]
VIG = (1 - 0.22 * np.clip(((xx - W/2) / (W*0.75))**2 + ((yy - H/2) / (H*0.7))**2, 0, 1))[..., None].astype(np.float32)

def grade(img):
    f = img.astype(np.float32) / 255
    f = (f - 0.5) * 1.05 + 0.51; f[..., 2] *= 1.015; f[..., 0] *= 0.99
    if f.shape[:2] == (H, W): f *= VIG
    return (np.clip(f, 0, 1) * 255).astype(np.uint8)
def cl(x): return min(1, max(0, x))
def ease(x): x = cl(x); return x*x*(3 - 2*x)
def eout(x): x = cl(x); return 1 - (1 - x)**3
def back(x):  # passa um pouco do ponto e volta (pop)
    x = cl(x); c = 1.9; return 1 + (c + 1)*(x - 1)**3 + c*(x - 1)**2
def cam(img, t, z0, z1, px0, px1, py0=0, py1=0, seed=0, size=(W, H), e=ease):
    w, h = size; k = e(t); hs, ws = img.shape[:2]; z = max(h/hs, w/ws) * (z0 + (z1 - z0)*k)
    fx = math.sin(t*2.1 + seed)*4 + math.sin(t*5.3 + seed*2)*1.5; fy = math.cos(t*1.7 + seed)*5 + math.sin(t*4.1 + seed)*1.5
    ang = math.sin(t*1.3 + seed)*0.35
    cx = ws/2 + (px0 + (px1 - px0)*k)*ws; cy = hs/2 + (py0 + (py1 - py0)*k)*hs
    M = cv2.getRotationMatrix2D((cx, cy), ang, z); M[0, 2] += w/2 - cx + fx; M[1, 2] += h/2 - cy + fy
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
def over(fr, o, a, dx=0, dy=0, s=1, cx=W/2, cy=H/2, ang=0, revx=None, clip=None):
    if a <= 0: return fr
    if dx or dy or s != 1 or ang:
        M = cv2.getRotationMatrix2D((cx, cy), ang, s); M[0, 2] += dx; M[1, 2] += dy
        o = cv2.warpAffine(o, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    al = (o[..., 3:4].astype(np.float32) / 255) * a
    if revx is not None: al[:, int(revx):] = 0          # revela da esquerda para a direita
    if clip is not None: al[:int(clip[0])] = 0; al[int(clip[1]):] = 0   # máscara de linha (texto sobe por dentro)
    return (fr*(1 - al) + o[..., :3]*al).astype(np.uint8)
def mblur(fr, k, vert=False):
    k = int(k)
    if k < 3: return fr
    ker = np.full((k, 1) if vert else (1, k), 1/k, np.float32); return cv2.filter2D(fr, -1, ker)
def shake(fr, t, t0, amp=14):
    if not (t0 <= t < t0 + 0.25): return fr
    d = (1 - (t - t0)/0.25) * amp
    return cv2.warpAffine(fr, np.float32([[1, 0, math.sin(t*90)*d], [0, 1, math.cos(t*70)*d]]), (W, H), borderMode=cv2.BORDER_REFLECT)

# ---------- cenas: f(t local em segundos) -> quadro ----------
def c_gancho(t):   # "PAGA ALUGUEL?" — o risco azul passa por cima de "aluguel" e a câmera treme no impacto
    fr = grade(cam(foto[1], t/2.8, 1.00, 1.16, 0.10, 0.03, seed=1, e=eout))
    fr = over(fr, ov[1], ease(t/0.25))
    p = back((t - 0.10)/0.30); fr = over(fr, ov[2], cl((t - 0.10)/0.12), 0, (1 - p)*90)
    p = back((t - 0.40)/0.30); fr = over(fr, ov[3], cl((t - 0.40)/0.12), 0, (1 - p)*90)
    r = eout((t - 1.05)/0.30); fr = over(fr, ov[4], 1 if r > 0 else 0, revx=60 + r*900)
    fr = shake(fr, t, 1.35)
    p = eout((t - 1.55)/0.40); return over(fr, ov[5], p, 0, (1 - p)*40)
def c_virar(t):    # "Seu aluguel pode virar A SUA CASA."
    fr = grade(cam(foto[2], t/2.6, 1.12, 1.02, -0.06, 0.04, seed=2))
    fr = over(fr, ov[1], 1)
    p = eout((t - 0.15)/0.35); fr = over(fr, ov[6], p, -(1 - p)*120)
    p = back((t - 0.50)/0.35); return over(fr, ov[7], cl((t - 0.5)/0.15), s=0.6 + 0.4*p, cx=330, cy=900)
COZ = 'A'   # revisão do dono 2026-10-14: carimbo torto reprovado → A = tipografia limpa, B = faixa azul
def c_cozinha(t):  # bancada, pia e armários; "pronta pra morar" entra sem caixa
    fr = grade(cam(foto[4], t/3.0, 1.00, 1.07, -0.21, -0.17, seed=3))
    if COZ == 'A':
        p = ease((t - 0.15)/0.4); fr = over(fr, ov[26], p, 0, (1 - p)*30)
        p = eout((t - 0.40)/0.45); fr = over(fr, ov[27], 1 if p > 0 else 0, 0, (1 - p)*170, clip=(1250, 1405))
        p = eout((t - 0.62)/0.45); fr = over(fr, ov[28], 1 if p > 0 else 0, 0, (1 - p)*170, clip=(1400, 1560))
        return fr
    r = eout((t - 0.30)/0.45); return over(fr, ov[29], 1 if r > 0 else 0, revx=r*W)
def c_quartos(t):  # tela dividida: quarto 1 entra pela esquerda (em cima), quarto 2 pela direita (embaixo)
    p = eout(t/0.55); h2 = H//2
    top = cam(foto[5], t/3.0, 1.04, 1.12, 0.02, -0.03, seed=4, size=(W, h2))
    bot = cam(foto[6], t/3.0, 1.12, 1.04, -0.03, 0.03, seed=5, size=(W, h2))
    top = np.roll(top, int(-(1 - p)*W), axis=1); bot = np.roll(bot, int((1 - p)*W), axis=1)
    if p < 1: top = mblur(top, (1 - p)*60); bot = mblur(bot, (1 - p)*60)
    fr = grade(np.vstack([top, bot])) * VIG; fr = fr.astype(np.uint8)
    q = back((t - 0.45)/0.3); return over(fr, ov[10], cl((t - 0.45)/0.1), s=0.5 + 0.5*q, cx=540, cy=960)
def c_sala(t):
    fr = grade(cam(foto[3], t/2.6, 1.10, 1.02, -0.16, -0.08, seed=6))
    p = ease((t - 0.25)/0.35); return over(fr, ov[11], p, 0, (1 - p)*40)
def c_quintal(t):  # foto vertical: sobe devagar do piso para a abertura do quintal
    fr = grade(cam(foto[7], t/2.8, 1.06, 1.10, 0, 0, 0.06, -0.04, seed=7))
    p = ease((t - 0.25)/0.35); return over(fr, ov[12], p, 0, (1 - p)*40)
def c_check(t):    # checklist sobre a sala desfocada: cada item entra e o "check" pulsa
    fr = cam(foto[1], t/5.2, 1.20, 1.28, -0.04, -0.08, seed=8)
    fr = grade((cv2.GaussianBlur(fr, (0, 0), 12)*0.48).astype(np.uint8))
    p = eout((t - 0.10)/0.45); fr = over(fr, ov[13], p, 0, (1 - p)*50)
    for j in range(4):
        t0 = 0.65 + j*0.45; p = eout((t - t0)/0.4)
        fr = over(fr, ov[14 + j], p, (1 - p)*160, 0)
    return fr
def c_fecho(t):    # sala nítida → desfoca enquanto Matheus entra com a chave; textos em sequência
    base = grade(cam(foto[1], t/5.0, 1.04, 1.10, 0.06, 0.02, seed=11))
    b = ease((t - 0.3)/1.1)
    if b > 0: base = cv2.GaussianBlur(base, (0, 0), 0.1 + 16*b)
    fr = over(base, ov[18], b)
    for idx, t0, t1, dx, dy in [(19, 0.35, 1.05, 320, 0), (20, 0.75, 1.15, 0, -40), (21, 1.00, 1.40, 0, 60), (22, 1.30, 1.70, 0, 30), (23, 1.55, 1.95, 0, 0)]:
        p = eout((t - t0)/(t1 - t0))
        if p > 0: fr = over(fr, ov[idx], p, dx*(1 - p), dy*(1 - p))
    return fr

# ---------- transições: (A, B, progresso 0..1) -> quadro ----------
def t_feed(A, B, u):   # rolagem de feed para cima
    e = ease(u); off = int(e*H); fr = np.vstack([A[off:], B[:off]]) if off else A
    return mblur(fr, math.sin(u*math.pi)*70, vert=True)
def t_cortina(A, B, u):  # cortina diagonal com faixa azul da marca
    e = ease(u); pos = -500 + e*(W + 1000); edge = xx + (yy - H/2)*0.28
    fr = np.where((edge < pos)[..., None], B, A)
    band = ((edge >= pos) & (edge < pos + 70))[..., None]
    return np.where(band, np.array([255, 139, 59], np.uint8), fr).astype(np.uint8)
def t_whip(A, B, u):
    s = math.sin(u*math.pi)
    sa = np.roll(A, int(-u*W*0.6), axis=1); sb = np.roll(B, int((1 - u)*W*0.6), axis=1)
    return mblur(cv2.addWeighted(sa, 1 - u, sb, u, 0), 9 + s*120)
def t_zoom(A, B, u):
    s = 1 + 0.25*math.sin(u*math.pi/2)
    a = cv2.resize(A, None, fx=s, fy=s); y = (a.shape[0] - H)//2; x = (a.shape[1] - W)//2
    return cv2.addWeighted(a[y:y+H, x:x+W], 1 - u, B, u, 0)
def t_corte(A, B, u): return cv2.addWeighted(A, 1 - ease(u), B, ease(u), 0)

CENAS = [(c_gancho, 2.8), (c_virar, 2.6), (c_cozinha, 3.0), (c_quartos, 3.0), (c_sala, 2.6), (c_quintal, 2.8), (c_check, 5.2), (c_fecho, 5.0)]
TRANS = [t_feed, t_cortina, t_whip, t_zoom, t_cortina, t_zoom, t_corte]
INI = [0.0]
for _, d in CENAS[:-1]: INI.append(INI[-1] + d - TR)
TOTAL = INI[-1] + CENAS[-1][1]

def quadro(t, previa=False):
    i = max(k for k in range(len(CENAS)) if INI[k] <= t)
    f, d = CENAS[i]
    if i > 0 and t < INI[i] + TR:          # dentro da transição da cena anterior para esta
        fa, da = CENAS[i - 1]; u = (t - INI[i]) / TR
        fr = TRANS[i - 1](fa(t - INI[i - 1]), f(t - INI[i]), u)
    else:
        fr = f(t - INI[i])
    fr = over(fr, ov[24], 1.0)             # espaço fixo do adesivo de link (topo esquerdo)
    return over(fr, ov[25], 1.0) if previa else fr

if '--cozinha' in ARGS: COZ = ARGS[ARGS.index('--cozinha') + 1]
if '--quadros' in ARGS:
    for s in ARGS[ARGS.index('--quadros') + 1].split(','):
        cv2.imwrite(f'{OUT}/quadro-{float(s):05.2f}s.png', quadro(float(s), previa=True))
else:
    PREVIA = '--previa' in ARGS
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
    n = int(round(TOTAL*FPS))
    for k in range(n): p.stdin.write(quadro(k/FPS, PREVIA).tobytes())
    p.stdin.close(); p.wait(); print(f'{TOTAL:.1f} s')
