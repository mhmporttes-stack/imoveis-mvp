CHECK='<svg viewBox="0 0 40 40" width="46" height="46"><circle cx="20" cy="20" r="20" fill="#3B8BFF"/><path d="M11 21l7 7 12-14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
B={"doc":"Documentação grátis","parc":"Parcelas que cabem no seu bolso","renda":"Renda a partir de R$ 1.650","reg":"Não precisa ser registrado"}
def ben(keys,fs=42,gap=26):
    return "".join(f'<div class="b" style="font-size:{fs}px;margin-bottom:{gap}px">{CHECK}<span>{B[k]}</span></div>' for k in keys)
CSS="""
:root{--az:#3B8BFF;--nv:#08112E}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#000}
.p{position:relative;width:1311px;height:1819px;overflow:hidden;font-family:Sora,sans-serif;color:#fff;background:var(--nv)}
.ceu{position:absolute;left:0;top:0;width:1311px;height:1618px;object-fit:cover}
.g{position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,17,46,.55) 0%,rgba(8,17,46,.1) 22%,rgba(8,17,46,0) 38%,rgba(8,17,46,.55) 52%,rgba(8,17,46,.93) 60%,#08112E 66%,#08112E 100%)}
.g2{position:absolute;left:0;right:0;top:1000px;bottom:0;z-index:3;background:linear-gradient(180deg,rgba(8,17,46,0),rgba(8,17,46,.9) 120px,#08112E 160px)}
.pose{position:absolute;filter:drop-shadow(0 30px 50px rgba(0,0,0,.45));z-index:2}
.an{font-family:Anton,sans-serif;text-transform:uppercase;line-height:1.0;letter-spacing:.005em}
.az{color:var(--az)} .abs{position:absolute}
.logo{position:absolute;top:92px;left:0;right:0;text-align:center;z-index:5}
.logo img{width:290px}
.b{display:flex;align-items:center;gap:20px;font-weight:700;line-height:1.15;text-shadow:0 2px 12px rgba(0,0,0,.5)}
.b svg{flex:none}
.ft{position:absolute;left:0;right:0;bottom:0;height:340px;z-index:6;text-align:center;
 background:linear-gradient(180deg,rgba(8,17,46,0) 0,#08112E 30px)}
.url{position:absolute;left:0;right:0;text-align:center;font-weight:700;font-size:35px;color:#fff;z-index:6}
.nm{font-family:Anton,sans-serif;font-size:56px;letter-spacing:.02em;line-height:1}
.fp{position:absolute;left:0;right:0;text-align:center;z-index:6}
.sub{font-weight:700;font-size:35px;letter-spacing:.05em;color:#cfe0ff}
.cr{font-weight:800;font-size:42px;margin-top:6px}
.mi{font-size:34px;font-weight:600;color:#b9c9ea;margin-top:10px}
.cam{font-family:Anton,sans-serif;font-size:50px;text-transform:uppercase;letter-spacing:.02em;line-height:1;color:var(--az);text-align:center}
.pl{font-family:'Playfair Display',serif;font-style:italic;font-weight:600}
"""
def footer(top=1520):
    return f'''<div class="fp" style="top:{top}px"><div class="nm">MATHEUS MACHADO CORRETOR DE IMÓVEIS</div>
<div class="sub" style="margin-top:12px">ESPECIALISTA NA COMPRA DO PRIMEIRO IMÓVEL</div>
<div class="cr">CRECI 323106 &nbsp;·&nbsp; <span class="az">(14) 99105-6706</span></div>
<div class="mi">Sujeito à análise e aprovação de crédito.</div></div>'''
def logo(): return '<div class="logo"><img src="img/mcmv-logo-branco.png"></div>'
def base(inner,sky_top=0,g2top=1000): return f'<section class="p" id="x"><img class="ceu" src="img/ceu.jpg" style="top:{sky_top}px"><div class="g"></div><div class="g2" style="top:{g2top}px"></div>{inner}</section>'
def cols(keys,qr="qr-a",tile=312,top=1085,fs=38):
    return f'''<div class="abs" style="left:110px;top:{top+8}px;width:790px;z-index:6">{ben(keys,fs)}
<div style="font-size:38px;font-weight:800;line-height:1.2;margin-top:6px">Descubra seu poder de compra<br><span class="az">em menos de 2 minutos</span></div></div>
<div class="abs" style="left:910px;width:{tile}px;top:{top}px;z-index:6"><div class="cam" style="margin-bottom:14px;font-size:42px;white-space:nowrap;margin-left:-20px;margin-right:-20px">Aponte a câmera</div><img src="img/{qr}.png" style="width:{tile}px;display:block"></div>
<div class="url" style="top:{top+tile+62}px">matheusmachadoimoveis.com.br/c/382eeb4</div>'''
S=[]
# 1 chave
S.append(base(logo()+f'''<div class="abs an" style="top:205px;left:0;right:0;text-align:center;font-size:140px;z-index:5;text-shadow:0 6px 30px rgba(0,0,0,.5)">SÓ PAGA ALUGUEL<br><span class="az">EM 2026 QUEM QUER</span></div>
<img class="pose" src="img/chave.png" style="left:245px;top:470px;height:972px">'''+cols(["doc","parc","renda"])+footer()))
# 2 família (fallback comemorando)
S.append(base(logo()+f'''<div class="abs an" style="top:205px;left:0;right:0;text-align:center;font-size:140px;z-index:5;text-shadow:0 6px 30px rgba(0,0,0,.5)"><span class="az">SÓ PAGA ALUGUEL</span><br>EM 2026 QUEM QUER</div>
<img class="pose" src="img/comemorando.png" style="left:225px;top:470px;height:972px">'''+cols(["doc","reg","renda"])+footer(),sky_top=0))
# 3 desconto
S.append(base(logo()+f'''<div class="abs an" style="top:190px;left:0;right:0;text-align:center;font-size:66px;z-index:5">SÓ PAGA ALUGUEL <span class="az">EM 2026 QUEM QUER</span></div>
<div class="abs an" style="top:300px;left:0;right:0;text-align:center;font-size:92px;z-index:5">DESCONTOS DE ATÉ</div>
<div class="abs an az" style="top:395px;left:0;right:0;text-align:center;font-size:208px;z-index:5;white-space:nowrap;text-shadow:0 8px 40px rgba(0,0,0,.45)">R$ 85.000,00</div>
<div class="abs pl" style="top:625px;left:0;right:0;text-align:center;font-size:62px;z-index:5">em alguns imóveis</div>
<img class="pose" src="img/apontando.png" style="left:470px;top:700px;height:855px">
<div class="abs" style="left:110px;top:790px;width:700px;z-index:6">{ben(["doc","renda"],38,28)}</div>
<div class="abs" style="left:110px;top:1062px;z-index:6"><img src="img/qr-b.png" style="width:390px;display:block"></div>
<div class="abs" style="left:545px;top:1232px;width:690px;z-index:6"><div class="cam" style="text-align:left;font-size:90px">Aponte a câmera</div>
<div style="font-size:40px;font-weight:800;line-height:1.25;margin-top:18px">Descubra seu poder de compra<br><span class="az">em menos de 2 minutos</span></div></div>
<div class="url" style="top:1468px">matheusmachadoimoveis.com.br/c/382eeb4</div>'''+footer(1530),g2top=1215))
# 4 nome sujo
S.append(base(logo()+f'''<div class="abs an" style="top:200px;left:0;right:0;text-align:center;font-size:250px;z-index:5;text-shadow:0 6px 30px rgba(0,0,0,.5)">NOME <span class="az">SUJO?</span></div>
<div class="abs pl" style="top:455px;left:0;right:0;text-align:center;font-size:58px;z-index:5;text-shadow:0 4px 20px rgba(0,0,0,.6)">Também te ajudamos com isso</div>
<img class="pose" src="img/pensando.png" style="left:290px;top:520px;height:880px">
<div class="abs an" style="top:1010px;left:0;right:0;text-align:center;font-size:74px;z-index:5;white-space:nowrap">SÓ PAGA ALUGUEL <span class="az">EM 2026 QUEM QUER</span></div>'''+cols(["doc","parc","renda"],top=1100,fs=38)+footer(1538)))
for i,s in enumerate(S,1):
    open(f"p{i}.html","w").write(f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="fontes" content="family=Anton&family=Sora:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,600"><style>{CSS}</style></head><body>{s}</body></html>')
