# Monta o vídeo vertical 1080x1920 do Terras de São Paulo só com as fotos reais do CRM:
# movimento de câmera (push/pull/pan com leve flutuação de gimbal), transições e textos. Sem áudio.
import cv2, numpy as np, subprocess, sys, math
S=sys.argv[1]; FPS=30; W,H=1080,1920
fotos=[cv2.imread(f'{S}/../terras-fotos/foto{i}.jpg') for i in range(1,6)]
ov=[cv2.imread(f'{S}/ov/lamina-{i:02d}.png', cv2.IMREAD_UNCHANGED) for i in range(1,14)]

def grade(img):
    f=img.astype(np.float32)/255
    f=np.clip((f-0.5)*1.06+0.5+0.01,0,1)            # contraste leve
    f[...,2]*=1.02; f[...,0]*=0.985                  # um toque quente
    f*= VIG                                           # vinheta
    return (np.clip(f,0,1)*255).astype(np.uint8)
yy,xx=np.mgrid[0:H,0:W]; VIG=(1-0.22*np.clip(((xx-W/2)/(W*0.75))**2+((yy-H/2)/(H*0.7))**2,0,1))[...,None].astype(np.float32)
def cam(img, t, z0,z1, px0,px1, py0=0,py1=0, seed=0):
    e=t*t*(3-2*t)                                     # easing suave
    hs,ws=img.shape[:2]; base=H/hs
    z=base*(z0+(z1-z0)*e)
    fx=math.sin(t*2.1+seed)*4+math.sin(t*5.3+seed*2)*1.5   # flutuação de gimbal
    fy=math.cos(t*1.7+seed)*5+math.sin(t*4.1+seed)*1.5
    ang=math.sin(t*1.3+seed)*0.35
    cx=ws/2+(px0+(px1-px0)*e)*ws; cy=hs/2+(py0+(py1-py0)*e)*hs
    M=cv2.getRotationMatrix2D((cx,cy),ang,z)
    M[0,2]+=W/2-cx+fx; M[1,2]+=H/2-cy+fy
    out=cv2.warpAffine(img,M,(W,H),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT)
    bl=cv2.GaussianBlur(out,(0,0),1.2); out=cv2.addWeighted(out,1.45,bl,-0.45,0)   # nitidez
    return out

def over(fr, o, a, dy=0):
    if a<=0: return fr
    if dy: o=np.roll(o,int(dy),axis=0)
    al=(o[...,3:4].astype(np.float32)/255)*a
    return (fr*(1-al)+o[...,:3]*al).astype(np.uint8)

def mblur(fr,k):
    k=int(k)
    if k<3: return fr
    ker=np.zeros((1,k),np.float32); ker[0,:]=1/k
    return cv2.filter2D(fr,-1,ker)

# cenas: (foto, dur, z0,z1, px0,px1, py0,py1, overlay)
cenas=[(0,4.2,1.00,1.12,0.10,0.04,0.0,0.0,0),
       (1,3.0,1.06,1.06,-0.10,0.10,0.0,0.0,1),
       (2,3.0,1.14,1.02,0.02,-0.04,0.03,0.0,2),
       (3,3.0,1.02,1.12,0.0,0.06,0.0,0.02,3),
       (4,3.0,1.08,1.08,0.10,-0.08,0.0,0.0,4),
       (0,2.6,1.20,1.26,-0.12,-0.10,0.0,0.0,5),
       (3,2.6,1.20,1.26,0.06,0.08,0.0,0.0,6)]
FIM=4.0; TR=0.36
frames=[]
def cena_frames(c,ci):
    i,d,z0,z1,a,b,c0,c1,o=c; n=int(d*FPS); out=[]
    for k in range(n):
        t=k/(n-1); fr=cam(fotos[i],t,z0,z1,a,b,c0,c1,seed=ci)
        if ci>=5: fr=(cv2.GaussianBlur(fr,(0,0),9)*0.55).astype(np.uint8)   # fundo das ofertas
        fr=grade(fr)
        if o is not None:
            tt=k/FPS; ain=min(1,max(0,(tt-0.25)/0.35)); aout=1 if ci==6 else min(1,max(0,(d-tt-0.15)/0.3))
            a_=min(ain,aout); dy=(1-ain)*40 if ci<5 else (1-ain)*60
            fr=over(fr,ov[o],a_,dy)
        out.append(fr)
    return out
seqs=[cena_frames(c,ci) for ci,c in enumerate(cenas)]
# transições: whip pan (1→2, 4→5), zoom-through (2→3, 3→4), flash branco (5→ofertas), corte seco entre ofertas
def whip(A,B,n,dirn=1):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); s=math.sin(t*math.pi)
        sa=np.roll(A[-n+k],int(-dirn*t*W*0.6),axis=1); sb=np.roll(B[k],int(dirn*(1-t)*W*0.6),axis=1)
        f=cv2.addWeighted(sa,1-t,sb,t,0); r.append(mblur(f,9+s*120))
    return r
def zoomthru(A,B,n):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); s=1+0.25*math.sin(t*math.pi/2)
        a=cv2.resize(A[-n+k],None,fx=s,fy=s); y=(a.shape[0]-H)//2; x=(a.shape[1]-W)//2; a=a[y:y+H,x:x+W]
        r.append(cv2.addWeighted(a,1-t,B[k],t,0))
    return r
def flash(A,B,n):
    r=[]
    for k in range(n):
        t=(k+1)/(n+1); base=A[-n+k] if t<0.5 else B[k]; w=math.sin(t*math.pi)*0.85
        r.append(cv2.addWeighted(base,1-w,np.full_like(base,255),w,0))
    return r
n=int(TR*FPS)
kinds=['whip','zoom','zoom','whip','flash','cut']
out=seqs[0][:-n]
for j,kind in enumerate(kinds):
    A,B=seqs[j],seqs[j+1]
    if kind=='cut': out+= B; continue
    tr={'whip':whip,'zoom':zoomthru,'flash':flash}[kind](A,B,n)
    out+= tr + B[n:-n] if j<len(kinds)-1 else tr+B[n:]
# fecho: fundo da marca entra por cima da última cena; Matheus entra pela direita e os textos aparecem em sequência
def shift(o,dx,dy):
    M=np.float32([[1,0,dx],[0,1,dy]])
    return cv2.warpAffine(o,M,(W,H),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0,0))
def ease(x): x=min(1,max(0,x)); return 1-(1-x)**3
bg=ov[7][...,:3].copy(); last=out[-1]; nf=int(FIM*FPS)
camadas=[(8,0.15,0.75,260,0),(9,0.45,0.85,0,-40),(10,0.70,1.10,0,60),(11,0.95,1.35,0,50),(12,1.20,1.60,0,30)]
for k in range(nf):
    t=k/FPS; a=ease(t/0.35)
    fr=cv2.addWeighted(last,1-a,bg,a,0) if a<1 else bg.copy()
    for idx,t0,t1,dx,dy in camadas:
        p=ease((t-t0)/(t1-t0))
        if p<=0: continue
        o=ov[idx]
        if dx or dy: o=shift(o,dx*(1-p),dy*(1-p))
        if idx==8:                       # leve aproximação contínua na foto
            z=1+0.025*(t/FIM); o=cv2.resize(o,None,fx=z,fy=z); o=o[o.shape[0]-H:,:W] if o.shape[1]>=W else o
        fr=over(fr,o,p)
    out.append(fr)
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
   '-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',sys.argv[2]],stdin=subprocess.PIPE)
for f in out: p.stdin.write(f.tobytes())
p.stdin.close(); p.wait(); print(len(out)/FPS,'s')
