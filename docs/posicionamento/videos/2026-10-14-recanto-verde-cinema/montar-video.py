# Reels "cinema" do Recanto Verde (pedido do dono, 2026-10-14): satélite aproximando de Marília → drone de cima que
# inclina até o horizonte (vira 3D) → drone desce até a portaria → frente do condomínio → sobe → frente da casa →
# porta abrindo → entra e passeia pelos cômodos → fecho com Matheus. Só material REAL: satélite (Esri/Maxar, com
# crédito na tela) e vídeos da incorporadora enviados pelo dono (Drive). Nada gerado por IA.
# Uso: python3 montar-video.py <clipes> <camadas> <pasta-satelite> <saida.mp4|pasta> [--quadros 1,2,...]
import cv2, numpy as np, subprocess, sys, math, json, os
CL, OVD, SAT, OUT = sys.argv[1:5]; ARGS = sys.argv[5:]
FPS = 30; W, H = 1080, 1920
AQUI = os.path.dirname(os.path.abspath(__file__)); IDX = json.load(open(f'{AQUI}/indice.json'))
_ov = {}
def ov(i):
    if i not in _ov: _ov[i] = cv2.imread(f'{OVD}/lamina-{i:02d}.png', cv2.IMREAD_UNCHANGED)
    return _ov[i]
def L(n): return ov(IDX[n])
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
def bbox(o): ys, xs = np.where(o[..., 3] > 10); return xs.min(), ys.min(), xs.max(), ys.max()
def zoom(fr, s, cx=W/2, cy=H/2):
    M = cv2.getRotationMatrix2D((cx, cy), 0, s); return cv2.warpAffine(fr, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = (1 - 0.16*np.clip(((XX - W/2)/(W*0.75))**2 + ((YY - H/2)/(H*0.7))**2, 0, 1))[..., None]
def grade(fr):   # cor única para drone e câmera: contraste leve, um toque quente, vinheta
    f = fr.astype(np.float32)/255; f = (f - 0.5)*1.05 + 0.5; f[..., 2] *= 1.02; f[..., 0] *= 0.985
    return (np.clip(f*VIG, 0, 1)*255).astype(np.uint8)

# ---------------- satélite ----------------
info = json.load(open(f'{SAT}/sat_info.json')); MOS = {}
FIM = (-22.1614, -49.9752)                       # casas de telhado branco do Recanto Verde (conferido com o drone)
def xy(lat, lon, z): n = 2**z; return (lon + 180)/360*n, (1 - math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
def satelite(t, d):
    u = t/d; zf = 11.7 + (17.35 - 11.7)*(u**1.15)            # aproximação de velocidade constante (escala exponencial)
    Lz = min(18, max(11, int(zf))); s = 2**(zf - Lz)
    if Lz not in MOS: MOS[Lz] = cv2.imread(f'{SAT}/sat_z{Lz}.jpg')
    ox, oy = info[str(Lz)]; px, py = xy(*FIM, Lz); cx, cy = (px - ox)*256, (py - oy)*256
    M = cv2.getRotationMatrix2D((cx, cy), -14*ease(u), s); M[0, 2] += W/2 - cx; M[1, 2] += H/2 - cy
    fr = cv2.warpAffine(MOS[Lz], M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    fr = grade(fr)
    a = ease(t/0.5)*(1 - ease((t - d + 1.3)/0.5)); fr = over(fr, L('titulo-sat'), a, 0, (1 - ease(t/0.5))*40)
    return over(fr, L('credito-sat'), 1.0)

# ---------------- clipes ----------------
def ler(nome):
    cap = cv2.VideoCapture(f'{CL}/{nome}.mp4'); fs = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fs.append(grade(f))
    return fs

def legenda(fr, chave, t, t0=0.15, passo=0.16):
    pal = IDX.get(f'leg-{chave}')
    if not pal: return fr
    fr = over(fr, L('grad-leg'), ease((t - t0 + 0.2)/0.3))
    for i, (norm, ativo) in enumerate(pal):
        ti = t0 + i*passo
        if t < ti: break
        p = back((t - ti)/0.22); camada = ov(ativo) if (i == len(pal) - 1 or t < ti + passo) else ov(norm)
        x0, y0, x1, y1 = bbox(camada)
        fr = over(fr, camada, cl((t - ti)/0.08), s=0.7 + 0.3*p, cx=(x0 + x1)/2, cy=(y0 + y1)/2)
    return fr

# (clipe, legenda, posição do "M" — diferente em cada cena, fora de texto e do adesivo, transição para o próximo)
SEQ = [('SAT', None, (950, 250), 'mergulho'),
       ('c01-drone-cima', None, (80, 250), 'desfoque'),
       ('c02-drone-portaria', 'portaria1', (930, 1650), 'flash'),
       ('c03-portaria', 'portaria2', (520, 240), 'desfoque'),
       ('c04-drone-sobe', None, (80, 720), 'desfoque'),
       ('c05-frente-casa', 'casa', (950, 720), 'corte'),
       ('c06-porta', 'porta', (950, 1480), 'portal'),
       ('c07-corredor-sala', 'sala', (300, 240), 'chicote'),
       ('c08-cozinha', 'cozinha', (80, 940), 'chicote'),
       ('c09-casal', 'casal', (950, 940), 'chicote'),
       ('c10-solteiro', 'solteiro', (720, 1650), 'desfoque'),
       ('FECHO', None, None, None)]
TR = {'mergulho': 15, 'desfoque': 9, 'flash': 8, 'corte': 0, 'portal': 12, 'chicote': 8}

def transicao(tipo, A, B, u):
    e = ease(u)
    if tipo == 'mergulho':   # satélite continua aproximando e o drone "assenta" por baixo
        return cv2.addWeighted(zoom(A, 1 + 0.5*e), 1 - e, zoom(B, 1.35 - 0.35*e), e, 0)
    if tipo == 'desfoque':
        k = math.sin(u*math.pi)*14 + 0.1
        return cv2.addWeighted(cv2.GaussianBlur(A, (0, 0), k), 1 - e, cv2.GaussianBlur(B, (0, 0), k), e, 0)
    if tipo == 'flash':
        w = math.sin(u*math.pi)*0.9; base = A if u < 0.5 else B
        return cv2.addWeighted(base, 1 - w, np.full_like(base, 255), w, 0)
    if tipo == 'portal':     # entra pela porta: empurra para dentro com brilho
        a = zoom(A, 1 + 1.2*e); w = math.sin(u*math.pi)*0.55
        fr = cv2.addWeighted(a, 1 - e, zoom(B, 1.25 - 0.25*e), e, 0)
        return cv2.addWeighted(fr, 1 - w, np.full_like(fr, 250), w, 0)
    if tipo == 'chicote':
        s = math.sin(u*math.pi); sa = np.roll(A, int(-u*W*0.7), axis=1); sb = np.roll(B, int((1 - u)*W*0.7), axis=1)
        fr = cv2.addWeighted(sa, 1 - e, sb, e, 0); k = int(9 + s*110)
        return cv2.filter2D(fr, -1, np.full((1, k), 1/k, np.float32))
    return B

def gerar():
    """Produz os quadros do vídeo inteiro, em ordem (2 clipes na memória por vez)."""
    def quadros(nome):
        if nome == 'SAT': d = 3.8; return [satelite(k/FPS, d) for k in range(int(d*FPS))]
        if nome == 'FECHO': return None
        return ler(nome)
    atual = quadros(SEQ[0][0]); entrada = 0; ultimo = None
    for i, (nome, leg, marca, tr) in enumerate(SEQ):
        if nome == 'FECHO': break
        nxt = SEQ[i + 1][0]; prox = quadros(nxt) if nxt != 'FECHO' else None
        n = TR[tr] if prox is not None else 0
        corpo = atual[entrada:len(atual) - n]
        for k, fr in enumerate(corpo):
            t = (entrada + k)/FPS
            if leg: fr = legenda(fr, leg, t)
            if nome.startswith('c0') or nome.startswith('c1'): fr = over(fr, L('credito-video'), 1.0)
            yield over(fr, L('marca-m'), 1.0, *marca), i
        for k in range(n):
            u = (k + 1)/(n + 1); A = atual[len(atual) - n + k]; B = prox[k]
            yield over(transicao(tr, A, B, u), L('marca-m'), 1.0, *(SEQ[i + 1][2] if u > 0.5 else marca)), i
        ultimo = atual[-1]; atual = prox; entrada = n
    # fecho: última imagem real desfocando enquanto Matheus entra com a chave
    base0 = ultimo; d = 4.6
    for k in range(int(d*FPS)):
        t = k/FPS; base = zoom(base0, 1.0 + 0.03*t/d); b = ease((t - 0.2)/1.0)
        if b > 0: base = cv2.GaussianBlur(base, (0, 0), 0.1 + 18*b)
        fr = over(base, L('fecho-escurece'), b)
        for nome, t0, t1, dx, dy in [('fecho-matheus', 0.3, 1.0, 320, 0), ('fecho-marca', 0.7, 1.1, 0, -30), ('fecho-titulo', 0.85, 1.25, 0, -40),
                                     ('fecho-cta', 1.1, 1.5, 0, 60), ('fecho-rodape', 1.5, 1.9, 0, 0)]:
            p = eout((t - t0)/(t1 - t0))
            if p > 0: fr = over(fr, L(nome), p, dx*(1 - p), dy*(1 - p))
        yield fr, len(SEQ) - 1

def finalizar(fr, previa):
    fr = over(fr, L('adesivo-sombra'), 1.0)
    return over(fr, L('adesivo-previa'), 1.0) if previa else fr

if '--quadros' in ARGS:
    alvo = sorted(float(s) for s in ARGS[ARGS.index('--quadros') + 1].split(','))
    for k, (fr, i) in enumerate(gerar()):
        t = k/FPS
        if alvo and t >= alvo[0] - 1e-6:
            cv2.imwrite(f'{OUT}/quadro-{t:05.2f}s.png', finalizar(fr, True)); alvo.pop(0)
        if not alvo: break
else:
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-metadata', 'artist=Matheus Machado — CRECI 323106-F', '-metadata', 'copyright=© Matheus Machado Imóveis (@mhm.machado). Proibida a reprodução sem autorização.', OUT], stdin=subprocess.PIPE)
    n = 0
    for fr, i in gerar(): p.stdin.write(finalizar(fr, '--previa' in ARGS).tobytes()); n += 1
    p.stdin.close(); p.wait(); print(f'{n/FPS:.1f} s')
