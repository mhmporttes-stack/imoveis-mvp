# TESTE de estilo novo (dono, 2026-10-14: "evoluir além de transições") — Recanto Verde.
#  1. Mapa animado com dado real (OpenStreetMap): rota real até o centro e até o mercado (tempos do OSRM), pin do condomínio.
#  2. Fotos reais da incorporadora com efeito 3D: profundidade estimada (Depth Anything V2 small, Apache-2.0) e câmera
#     "entrando" no cômodo — frente se move mais que o fundo. Nada é gerado/alterado no imóvel, só o ponto de vista.
#  3. Legenda cinética palavra a palavra (estilo Reels) e fecho com Matheus segurando a chave.
# Uso: python3 montar-video.py <fotos-drive> <camadas> <pasta-mapa> <modelo.onnx> <saida.mp4|pasta> [--quadros 1,2,..]
import cv2, numpy as np, subprocess, sys, math, json, os
import onnxruntime as ort
FOT, OV, MAP, MODELO, OUT = sys.argv[1:6]; ARGS = sys.argv[6:]
FPS = 30; W, H = 1080, 1920; TR = 0.45
AQUI = os.path.dirname(os.path.abspath(__file__))
IDX = json.load(open(f'{AQUI}/indice.json'))
_ov = {}
def ov(i):
    if i not in _ov: _ov[i] = cv2.imread(f'{OV}/lamina-{i:02d}.png', cv2.IMREAD_UNCHANGED)
    return _ov[i]
def L(nome): return ov(IDX[nome])

def cl(x): return min(1, max(0, x))
def ease(x): x = cl(x); return x*x*(3 - 2*x)
def eout(x): x = cl(x); return 1 - (1 - x)**3
def back(x): x = cl(x); c = 1.9; return 1 + (c + 1)*(x - 1)**3 + c*(x - 1)**2
def over(fr, o, a, dx=0, dy=0, s=1, cx=W/2, cy=H/2):
    if a <= 0: return fr
    if dx or dy or s != 1:
        M = cv2.getRotationMatrix2D((cx, cy), 0, s); M[0, 2] += dx; M[1, 2] += dy
        o = cv2.warpAffine(o, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    al = (o[..., 3:4].astype(np.float32)/255)*a
    return (fr*(1 - al) + o[..., :3]*al).astype(np.uint8)
def bbox(o):
    ys, xs = np.where(o[..., 3] > 10); return xs.min(), ys.min(), xs.max(), ys.max()

# ---------------- 3D: profundidade + novo ponto de vista ----------------
sess = ort.InferenceSession(MODELO)
def profundidade(img):
    h, w = img.shape[:2]; s = 518/min(h, w); ih, iw = int(round(h*s/14))*14, int(round(w*s/14))*14
    x = cv2.resize(img, (iw, ih), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32)/255
    x = (x - [0.485, 0.456, 0.406])/[0.229, 0.224, 0.225]
    d = sess.run(None, {'pixel_values': x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    d = cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC); d = (d - d.min())/(d.max() - d.min() + 1e-6)
    d = cv2.dilate(d, np.ones((7, 7), np.uint8)); return cv2.GaussianBlur(d, (0, 0), 3)   # 1 = perto
def preparar(nome, margem=1.16, fx=0.5, fy=0.5):
    img = cv2.imread(f'{FOT}/{nome}'); h, w = img.shape[:2]; s = max(H*margem/h, W*margem/w)
    img = cv2.resize(img, (int(w*s), int(h*s)), interpolation=cv2.INTER_AREA); h, w = img.shape[:2]
    cw, ch = int(W*margem), int(H*margem); x0 = int((w - cw)*fx); y0 = int((h - ch)*fy)
    img = img[y0:y0+ch, x0:x0+cw]; return img, profundidade(img)
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.18*np.clip(((XX - W/2)/(W*0.75))**2 + ((YY - H/2)/(H*0.7))**2, 0, 1))[..., None]
def vista3d(img, d, t, dolly, sx, sy=0.0, z0=1.0, z1=1.05):
    h, w = img.shape[:2]; s0 = W/w*(z0 + (z1 - z0)*t)*1.16
    u = (XX - W/2)/s0 + w/2; v = (YY - H/2)/s0 + h/2
    dd = cv2.remap(d, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    k = 1 + dolly*t*dd
    u = (u - w/2)/k + w/2 - sx*t*dd*w*0.035; v = (v - h/2)/k + h/2 - sy*t*dd*h*0.03
    fr = cv2.remap(img, u, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
    return np.clip(fr*VIG, 0, 255).astype(np.uint8)

# ---------------- mapa (OpenStreetMap) ----------------
# pontos: OSM/Nominatim; escola = Rua Manoel Pinheiro Mattos, 840 (Jd. Julieta) — trecho do OSM; mercado = link do Google Maps enviado pelo dono
CASA = (-22.16013, -49.97519); CENTRO = (-22.2146983, -49.9461078); SHOPPING = (-22.1863094, -49.9669183); ESCOLA = (-22.1643379, -49.9761410); MERCADO = (-22.1619219, -49.9751561)
info = json.load(open(f'{MAP}/mapa_info.json'))
def xy(lat, lon, z):
    n = 2**z; return (lon + 180)/360*n, (1 - math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
def tingir(img):   # estilo escuro da marca: ruas claras sobre azul-marinho
    img = img.copy(); b_, g_, r_ = [img[..., i].astype(int) for i in range(3)]
    img[(g_ > r_ + 8) & (g_ > b_ + 4)] = 226                                             # vegetação vira fundo neutro (não parecer água)
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)/255
    v = np.clip((lum - 0.80)/0.20, 0, 1)**1.4
    a = np.array([42, 20, 8], np.float32); b = np.array([190, 140, 85], np.float32)   # BGR: #08142A → #558CBE
    out = a + (b - a)*v[..., None]
    agua = (img[..., 0].astype(int) - img[..., 2].astype(int)) > 25                      # água/azul do OSM
    out[agua] = (90, 60, 30); return out.astype(np.uint8)
MOS = {int(z): tingir(cv2.imread(f'{MAP}/mapa_z{z}.png')) for z in info}
ROTAS = {n: json.load(open(f'{MAP}/rota_{n}.json')) for n in ('centro', 'shopping', 'escola', 'mercado')}
def mapa(lat, lon, zf):
    Lz = min(17, max(14, int(math.floor(zf)))); s = 2**(zf - Lz)
    ox, oy = info[str(Lz)]; px, py = xy(lat, lon, Lz); cx, cy = (px - ox)*256, (py - oy)*256
    M = np.float32([[s, 0, W/2 - s*cx], [0, s, H/2 - s*cy]])
    fr = cv2.warpAffine(MOS[Lz], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    def p(la, lo):
        x, y = xy(la, lo, Lz); return (W/2 + s*((x - ox)*256 - cx), H/2 + s*((y - oy)*256 - cy))
    return fr, p
def rota(fr, p, pts, prog, cor=(255, 139, 59), ape=False):
    if prog <= 0: return fr
    q = np.array([p(la, lo) for lo, la in pts], np.float32); n = max(2, int(len(q)*prog)); q = q[:n]
    if ape:   # caminho a pé: pontinhos
        seg = np.concatenate([np.linspace(q[i], q[i+1], max(2, int(np.linalg.norm(q[i+1]-q[i])/22)), endpoint=False) for i in range(len(q)-1)])
        for x, y in seg: cv2.circle(fr, (int(x), int(y)), 9, (255, 255, 255), -1, cv2.LINE_AA); cv2.circle(fr, (int(x), int(y)), 6, cor, -1, cv2.LINE_AA)
        return fr
    glow = fr.copy(); cv2.polylines(glow, [q.astype(np.int32)], False, cor, 26, cv2.LINE_AA)
    fr = cv2.addWeighted(fr, 0.65, glow, 0.35, 0)
    cv2.polylines(fr, [q.astype(np.int32)], False, cor, 10, cv2.LINE_AA)
    cv2.polylines(fr, [q.astype(np.int32)], False, (255, 255, 255), 3, cv2.LINE_AA); return fr
def pino(fr, x, y, a, cor=(255, 139, 59), pulso=0.0):
    if a <= 0: return fr
    o = fr.copy(); r = 18*back(a)
    if pulso > 0: cv2.circle(o, (int(x), int(y)), int(18 + 60*pulso), cor, 4, cv2.LINE_AA)
    cv2.circle(o, (int(x), int(y)), int(r + 8), (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(o, (int(x), int(y)), int(r), cor, -1, cv2.LINE_AA)
    return cv2.addWeighted(fr, 1 - cl(a*3), o, cl(a*3), 0) if pulso == 0 else o
def chip(fr, nome, x, y, a, emcima=True):
    if a <= 0: return fr
    o = L(nome); x0, y0, x1, y1 = bbox(o); w = x1 - x0
    dx = x - x0 - w/2; dy = (y - 40 - y1) if emcima else (y + 40 - y0)
    dx = min(max(dx, 40 - x0), W - 40 - x1)                               # não sai da tela
    p = eout(a); return over(fr, o, p, dx, dy + (1 - p)*30)
def lerp(a, b, t): return a + (b - a)*t

def c_mapa(t):   # 7,4 s: visão de Marília (centro e shopping, de carro) → voa até a casa → escola e mercado a pé
    meio = ((CASA[0] + CENTRO[0])/2 + 0.010, (CASA[1] + CENTRO[1])/2)   # casa mais para baixo, longe do título
    k = ease((t - 3.0)/1.6)
    lat = lerp(meio[0], CASA[0] - 0.0012, k); lon = lerp(meio[1], CASA[1] + 0.0004, k)
    zf = lerp(14.55, 16.55, k) + 0.25*ease((t - 5.4)/2.0)
    fr, p = mapa(lat, lon, zf)
    fr = rota(fr, p, ROTAS['centro'], ease((t - 0.5)/1.1))
    fr = rota(fr, p, ROTAS['shopping'], ease((t - 1.7)/1.0))
    fr = rota(fr, p, ROTAS['escola'], ease((t - 4.5)/0.8), ape=True)
    fr = rota(fr, p, ROTAS['mercado'], ease((t - 5.9)/0.5), ape=True)
    xc, yc = p(*CASA); xs, ys = p(*SHOPPING); xe, ye = p(*CENTRO); xk, yk = p(*ESCOLA); xm, ym = p(*MERCADO)
    fr = pino(fr, xe, ye, cl((t - 1.5)/0.3)); fr = pino(fr, xs, ys, cl((t - 2.6)/0.3)); fr = pino(fr, xk, yk, cl((t - 5.2)/0.3)); fr = pino(fr, xm, ym, cl((t - 6.3)/0.3))
    pul = ((t - 5.8) % 1.0) if t > 5.8 else 0
    fr = pino(fr, xc, yc, cl((t - 0.25)/0.3), pulso=pul)
    fr = over(fr, L('mapa-titulo'), ease((t - 0.1)/0.45)*(1 - ease((t - 1.3)/0.4)), 0, (1 - ease((t - 0.1)/0.45))*40)
    some = 1 - ease((t - 3.0)/0.4)                                      # chips de longe somem quando a câmera voa
    if some > 0:
        fr = chip(fr, 'chip-centro', xe, ye, cl((t - 1.6)/0.4)*some, emcima=False)
        fr = chip(fr, 'chip-shopping', xs, ys, cl((t - 2.7)/0.4)*some)
    fr = chip(fr, 'chip-escola', xk, yk, (t - 5.3)/0.4, emcima=False)
    fr = chip(fr, 'chip-casa', xc, yc, (t - 5.6)/0.45)
    fr = chip(fr, 'chip-mercado', xm, ym, (t - 6.4)/0.45, emcima=False)
    return over(fr, L('osm'), 1.0)

def legenda(fr, cena, t, t0=0.35, passo=0.17):
    fr = over(fr, L('grad-leg'), ease((t - t0 + 0.2)/0.3))
    pal = IDX[f'leg-{cena}']
    for i, (norm, ativo) in enumerate(pal):
        ti = t0 + i*passo
        if t < ti: break
        p = back((t - ti)/0.22)
        camada = ov(ativo) if (i == len(pal) - 1 or t < ti + passo) else ov(norm)
        x0, y0, x1, y1 = bbox(camada)
        fr = over(fr, camada, cl((t - ti)/0.08), s=0.7 + 0.3*p, cx=(x0 + x1)/2, cy=(y0 + y1)/2)
    return fr

QUARTOS = {}
def cena3d(nome, foto, d, dolly, sx, sy=0.0, fx=0.5, fy=0.5):
    def f(t):
        if foto not in QUARTOS: QUARTOS[foto] = preparar(foto, fx=fx, fy=fy)
        img, dep = QUARTOS[foto]
        return legenda(vista3d(img, dep, t/d, dolly, sx, sy), nome, t)
    return f, d

def c_fecho(t):
    if 'fecho' not in QUARTOS: QUARTOS['fecho'] = preparar('VERTICAL/JR_01039.jpg')
    img, dep = QUARTOS['fecho']
    base = vista3d(img, dep, 0.3 + t/12, 0.10, -0.4)
    b = ease((t - 0.3)/1.1)
    if b > 0: base = cv2.GaussianBlur(base, (0, 0), 0.1 + 16*b)
    fr = over(base, L('fecho-escurece'), b)
    for nome, t0, t1, dx, dy in [('fecho-matheus', 0.35, 1.05, 320, 0), ('fecho-marca', 0.75, 1.15, 0, -30), ('fecho-titulo', 0.9, 1.3, 0, -40),
                                 ('fecho-cta', 1.15, 1.55, 0, 60), ('fecho-rodape', 1.55, 1.95, 0, 0)]:
        p = eout((t - t0)/(t1 - t0))
        if p > 0: fr = over(fr, L(nome), p, dx*(1 - p), dy*(1 - p))
    return fr

def t_mergulho(A, B, u):   # do mapa "mergulha" para dentro da casa
    s = 1 + 1.4*ease(u); a = cv2.resize(A, None, fx=s, fy=s); y = (a.shape[0] - H)//2; x = (a.shape[1] - W)//2
    a = cv2.GaussianBlur(a[y:y+H, x:x+W], (0, 0), 0.1 + 10*u)
    return cv2.addWeighted(a, 1 - ease(u), B, ease(u), 0)
def t_luz(A, B, u):        # passagem com vazamento de luz quente
    w = math.sin(u*math.pi)*0.55; base = A if u < 0.5 else B
    luz = np.zeros_like(base); luz[:] = (170, 215, 255)
    m = np.clip(1 - np.abs(XX/W - u*1.6 + 0.3)*1.8, 0, 1)[..., None]
    return (base*(1 - w*m) + luz*w*m).astype(np.uint8) if True else base
def t_corte(A, B, u): return cv2.addWeighted(A, 1 - ease(u), B, ease(u), 0)

CENAS = [(c_mapa, 7.4),
         cena3d('sala', 'VERTICAL/JR_01039.jpg', 3.4, 0.16, 0.5),
         cena3d('cozinha', 'VERTICAL/JR_01046.jpg', 3.2, 0.14, -0.5),
         cena3d('quarto', 'VERTICAL/JR_01060.jpg', 3.4, 0.15, 0.4, 0.2),
         cena3d('solteiro', 'VERTICAL/JR_01053.jpg', 3.4, 0.14, -0.4),
         (c_fecho, 5.0)]
TRANS = [t_mergulho, t_luz, t_luz, t_corte, t_corte]
MARCA = [(950, 640), (950, 250), (80, 250), (960, 880), (520, 240)]   # "M" num lugar diferente em cada cena
INI = [0.0]
for _, d in CENAS[:-1]: INI.append(INI[-1] + d - TR)
TOTAL = INI[-1] + CENAS[-1][1]

def quadro(t, previa=False):
    i = max(k for k in range(len(CENAS)) if INI[k] <= t); f, d = CENAS[i]
    if i > 0 and t < INI[i] + TR:
        fa, _ = CENAS[i - 1]; fr = TRANS[i - 1](fa(t - INI[i - 1]), f(t - INI[i]), (t - INI[i])/TR)
    else: fr = f(t - INI[i])
    if i < len(CENAS) - 1: mx, my = MARCA[i]; fr = over(fr, L('marca-m'), 1.0, mx, my)
    fr = over(fr, L('adesivo-sombra'), 1.0)
    return over(fr, L('adesivo-previa'), 1.0) if previa else fr

if '--quadros' in ARGS:
    for s in ARGS[ARGS.index('--quadros') + 1].split(','):
        cv2.imwrite(f'{OUT}/quadro-{float(s):05.2f}s.png', quadro(float(s), previa=True))
else:
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-metadata', 'artist=Matheus Machado — CRECI 323106-F', '-metadata', 'copyright=© Matheus Machado Imóveis (@mhm.machado). Proibida a reprodução sem autorização.', OUT], stdin=subprocess.PIPE)
    for k in range(int(round(TOTAL*FPS))): p.stdin.write(quadro(k/FPS, '--previa' in ARGS).tobytes())
    p.stdin.close(); p.wait(); print(f'{TOTAL:.1f} s')
