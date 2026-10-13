# Vídeo vertical 1080x1920 do Terras de São Paulo só com as fotos reais do CRM (sem IA na imagem):
# movimento de câmera com leve flutuação de gimbal, transições, uma cena única de vantagens e fecho com Matheus
# entrando sobre uma foto da casa que vai desfocando. Sem áudio.
import cv2, numpy as np, subprocess, sys, math
S=sys.argv[1]; FPS=30; W,H=1080,1920
fotos=[cv2.imread(f'{S}/../terras-fotos/foto{i}.jpg') for i in range(1,6)]
ov=[None]+[cv2.imread(f'{S}/ov/lamina-{i:02d}.png', cv2.IMREAD_UNCHANGED) for i in range(1,19)]   # ov[1..18] (17 = sombra fixa do adesivo de link, 18 = prévia do adesivo)
yy,xx=np.mgrid[0:H,0:W]; VIG=(1-0.22*np.clip(((xx-W/2)/(W*0.75))**2+((yy-H/2)/(H*0.7))**2,0,1))[...,None].astype(np.float32)

def grade(img):
    f=img.astype(np.float32)/255
    f=(f-0.5)*1.06+0.51; f[...,2]*=1.02; f[...,0]*=0.985; f*=VIG
    return (np.clip(f,0,1)*255).astype(np.uint8)
def ease(x): x=min(1,max(0,x)); return x*x*(3-2*x)
def eout(x): x=min(1,max(0,x)); return 1-(1-x)**3
def cam(img,t,z0,z1,px0,px1,py0=0,py1=0,seed=0):
    e=ease(t); hs,ws=img.shape[:2]; z=H/hs*(z0+(z1-z0)*e)
    fx=math.sin(t*2.1+seed)*4+math.sin(t*5.3+seed*2)*1.5; fy=math.cos(t*1.7+seed)*5+math.sin(t*4.1+seed)*1.5
    ang=math.sin(t*1.3+seed)*0.35
    cx=ws/2+(px0+(px1-px0)*e)*ws; cy=hs/2+(py0+(py1-py0)*e)*hs
    M=cv2.getRotationMatrix2D((cx,cy),ang,z); M[0,2]+=W/2-cx+fx; M[1,2]+=H/2-cy+fy
    out=cv2.warpAffine(img,M,(W,H),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT)
    bl=cv2.GaussianBlur(out,(0,0),1.2); return cv2.addWeighted(out,1.45,bl,-0.45,0)
def shift(o,dx,dy):
    return cv2.warpAffine(o,np.float32([[1,0,dx],[0,1,dy]]),(W,H),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0,0))
def over(fr,o,a,dx=0,dy=0):
    if a<=0: return fr
    if dx or dy: o=shift(o,dx,dy)
    al=(o[...,3:4].astype(np.float32)/255)*a
    return (fr*(1-al)+o[...,:3]*al).astype(np.uint8)
def mblur(fr,k):
    k=int(k)
    if k<3: return fr
    ker=np.zeros((1,k),np.float32); ker[0,:]=1/k; return cv2.filter2D(fr,-1,ker)

# cômodos: (foto, duração, zoom ini/fim, pan x ini/fim, pan y ini/fim, rótulo)
comodos=[(0,4.2,1.00,1.12,0.10,0.04,0,0,1),(1,3.0,1.06,1.06,-0.10,0.10,0,0,2),(2,3.0,1.14,1.02,0.02,-0.04,0.03,0,3),
         (3,3.0,1.02,1.12,0,0.06,0,0.02,4),(4,3.0,1.08,1.08,0.10,-0.08,0,0,5)]
def cena(c,ci):
    i,d,z0,z1,a,b,c0,c1,o=c; n=int(d*FPS); out=[]
    for k in range(n):
        t=k/(n-1); tt=k/FPS
        fr=grade(cam(fotos[i],t,z0,z1,a,b,c0,c1,seed=ci))
        a_=min(ease((tt-0.25)/0.35),ease((d-tt-0.15)/0.3)); fr=over(fr,ov[o],a_,0,(1-a_)*40)
        out.append(fr)
    return out
seqs=[cena(c,ci) for ci,c in enumerate(comodos)]

# cena única de vantagens: foto da sala desfocada e escurecida, cabeçalho + 4 cartões entrando em sequência
DV=5.6; n=int(DV*FPS); vant=[]
for k in range(n):
    t=k/(n-1); tt=k/FPS
    fr=cam(fotos[1],t,1.18,1.26,-0.08,-0.04,seed=7)
    fr=grade((cv2.GaussianBlur(fr,(0,0),11)*0.5).astype(np.uint8))
    p=eout((tt-0.15)/0.45); fr=over(fr,ov[6],p,0,(1-p)*50)
    for j in range(4):
        p=eout((tt-0.55-j*0.32)/0.45); fr=over(fr,ov[7+j],p,(1-p)*-140,0)
    vant.append(fr)
seqs.append(vant)

def whip(A,B,n,d=1):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); s=math.sin(t*math.pi)
        sa=np.roll(A[-n+k],int(-d*t*W*0.6),axis=1); sb=np.roll(B[k],int(d*(1-t)*W*0.6),axis=1)
        r.append(mblur(cv2.addWeighted(sa,1-t,sb,t,0),9+s*120))
    return r
def zoomthru(A,B,n):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); s=1+0.25*math.sin(t*math.pi/2)
        a=cv2.resize(A[-n+k],None,fx=s,fy=s); y=(a.shape[0]-H)//2; x=(a.shape[1]-W)//2
        r.append(cv2.addWeighted(a[y:y+H,x:x+W],1-t,B[k],t,0))
    return r
def flash(A,B,n):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); base=A[-n+k] if t<0.5 else B[k]; w=math.sin(t*math.pi)*0.85
        r.append(cv2.addWeighted(base,1-w,np.full_like(base,255),w,0))
    return r
TR=int(0.36*FPS)
kinds=['whip','zoom','zoom','whip','flash']
out=seqs[0][:-TR]
for j,kind in enumerate(kinds):
    A,B=seqs[j],seqs[j+1]
    tr={'whip':whip,'zoom':zoomthru,'flash':flash}[kind](A,B,TR)
    out+=tr+(B[TR:-TR] if j<len(kinds)-1 else B[TR:])

# fecho: corte para a sala nítida; conforme Matheus entra, a foto desfoca e escurece; textos em sequência
FIM=4.6; nf=int(FIM*FPS); last=out[-1]
camadas=[(12,0.35,1.05,300,0),(13,0.75,1.15,0,-40),(14,1.00,1.40,0,60),(15,1.25,1.65,0,30),(16,1.50,1.90,0,0)]
for k in range(nf):
    t=k/FPS
    base=grade(cam(fotos[0],k/(nf-1),1.04,1.10,0.06,0.02,seed=11))
    b=ease((t-0.3)/1.1)                                  # 0 → 1 enquanto ele entra
    if b>0: base=cv2.GaussianBlur(base,(0,0),0.1+16*b)
    fr=over(base,ov[11],b)                               # escurece o lado do texto
    x=ease(t/0.35)
    if x<1: fr=cv2.addWeighted(last,1-x,fr,x,0)
    for idx,t0,t1,dx,dy in camadas:
        p=eout((t-t0)/(t1-t0))
        if p>0: fr=over(fr,ov[idx],p,dx*(1-p),dy*(1-p))
    out.append(fr)

# espaço fixo do adesivo de link (Instagram): mesma sombra em todos os quadros, fora das transições
PREVIA=len(sys.argv)>3   # versão de prévia com o adesivo simulado
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
   '-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',sys.argv[2]],stdin=subprocess.PIPE)
for f in out:
    f=over(f,ov[17],1.0)
    if PREVIA: f=over(f,ov[18],1.0)
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait(); print(len(out)/FPS,'s')
