# (vídeo cinema) Gera textos.html (camadas transparentes 1080x1920) + indice.json para o montar-video.py.
# Legendas cinéticas palavra a palavra (estilo Reels): cada palavra tem 2 camadas (normal e "ativa" com fundo azul).
import json, html
LEG = {   # trecho -> frase da legenda cinética (só fatos confirmados pelo dono/CRM)
  'portaria1': 'Condomínio fechado',
  'portaria2': 'com portaria 24 horas',
  'casa':      'Casa nova,',
  'porta':     'pronta pra morar',
  'sala':      'Sai do aluguel direto pra cá',
  'cozinha':   'Sala e cozinha integradas',
  'casal':     '2 quartos',
  'solteiro':  'Entrada parcelada em até 72x',
}
SYM = '../../../../public/assets/matheus-machado-symbol.png'
css = '''*{margin:0;padding:0;box-sizing:border-box} body{background:transparent}
.lamina{position:relative;width:1080px;height:1920px;overflow:hidden;font-family:"Open Sans",sans-serif;color:#fff}
.tit{font-weight:800;text-transform:uppercase;line-height:1.05;letter-spacing:-.01em}
.sh{text-shadow:0 4px 28px rgba(0,0,0,.6),0 1px 3px rgba(0,0,0,.5)}
.leg{position:absolute;left:70px;right:70px;top:1060px;display:flex;flex-wrap:wrap;gap:6px 22px;font-weight:800;font-size:92px;line-height:1.08;text-transform:uppercase;letter-spacing:-.01em}
.leg span{padding:2px 14px;border-radius:18px;text-shadow:0 4px 24px rgba(0,0,0,.65),0 1px 3px rgba(0,0,0,.6)}
.leg span.off{visibility:hidden}
.leg span.at{background:#3B8BFF;text-shadow:none;box-shadow:0 10px 30px rgba(59,139,255,.45)}
.chip{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:16px;padding:18px 30px;border-radius:999px;background:rgba(10,20,48,.92);border:2px solid rgba(59,139,255,.8);font-size:40px;font-weight:700;box-shadow:0 18px 40px rgba(0,0,0,.45);white-space:nowrap}
.chip b{color:#6FA8FF;font-weight:800}
.eyb{font-size:30px;font-weight:600;letter-spacing:.36em;text-transform:uppercase;color:#CFE0FF;display:flex;align-items:center;gap:18px}
.eyb::before{content:"";width:54px;height:4px;background:#3B8BFF;border-radius:2px}'''
secs=[]; idx={}
def add(nome, corpo, cls='lamina'):
    secs.append(f'<!-- {len(secs)+1:02d} {nome} -->\n<section class="{cls}">{corpo}</section>'); idx[nome]=len(secs)
add('grad-leg','<div style="position:absolute;left:0;right:0;top:880px;height:700px;background:linear-gradient(180deg,rgba(6,12,30,0),rgba(6,12,30,.62) 45%,rgba(6,12,30,.62) 75%,rgba(6,12,30,0))"></div>')
for cena,frase in LEG.items():
    ws=frase.split(); idx[f'leg-{cena}']=[]
    for i in range(len(ws)):
        for ativo in (0,1):
            spans=' '.join(f'<span class="{"at" if (j==i and ativo) else ("" if j==i else "off")}">{html.escape(w)}</span>' for j,w in enumerate(ws))
            add(f'leg-{cena}-{i}-{ativo}', f'<div class="leg">{spans}</div>')
        idx[f'leg-{cena}'].append([idx[f'leg-{cena}-{i}-0'], idx[f'leg-{cena}-{i}-1']])
# abertura no satélite
add('titulo-sat','<div class="sh" style="position:absolute;left:80px;top:300px"><div class="eyb">Marília · Zona Norte</div><div class="tit" style="font-size:120px;margin-top:20px">Recanto<br><span style="color:#3B8BFF">Verde</span></div></div>')
add('credito-sat','<div style="position:absolute;right:30px;bottom:30px;font-size:20px;color:rgba(255,255,255,.8);text-shadow:0 1px 3px #000">Imagem de satélite: Esri, Maxar</div>')
add('credito-video','<div style="position:absolute;right:30px;bottom:30px;font-size:20px;color:rgba(255,255,255,.8);text-shadow:0 1px 3px #000">Imagens: Recanto Verde / HZ Incorporadora</div>')
# fecho (textos mais altos — preferência 2026-10-14)
add('fecho-escurece','<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,12,30,.9) 0%,rgba(6,12,30,.74) 45%,rgba(6,12,30,.15) 82%),linear-gradient(0deg,rgba(6,12,30,.75),rgba(6,12,30,0) 40%)"></div>')
add('fecho-matheus','<img src="../../assets/boneco-3d/realista/chave.png" style="position:absolute;right:-270px;bottom:0;height:1160px">')
add('fecho-marca',f'<div style="position:absolute;left:80px;top:300px;display:flex;align-items:center;gap:26px"><img src="{SYM}" style="height:80px"><span style="width:4px;height:90px;background:#3673C2"></span><div><div style="font-size:36px;font-weight:800;letter-spacing:.02em">MATHEUS MACHADO</div><div style="font-size:20px;letter-spacing:.42em;color:#C9D3E6;margin-top:6px">CORRETOR DE IMÓVEIS</div></div></div>','lamina sh')
add('fecho-titulo','<div class="tit" style="position:absolute;left:80px;top:480px;font-size:104px">Faça sua<br><span style="color:#3B8BFF">simulação</span></div>','lamina sh')
add('fecho-cta','<div style="position:absolute;left:80px;top:760px;width:560px"><div style="height:6px;width:140px;background:#3673C2;border-radius:3px"></div><div style="font-size:44px;font-weight:700;margin-top:28px;line-height:1.3">Clique no link e<br>veja quanto fica<br>a sua parcela</div><div style="margin-top:30px;font-size:26px;font-weight:600;letter-spacing:.3em;color:#CFE0FF">GRATUITA E SEM<br>COMPROMISSO</div></div>','lamina sh')
add('fecho-rodape','<div style="position:absolute;left:80px;bottom:80px;width:470px;font-size:22px;line-height:1.45;color:#C9D3E6">CRECI 323106-F<br>Imagens do empreendimento e da casa decorada. Condições sujeitas a análise de crédito.</div>','lamina sh')
# adesivo de link: embaixo à esquerda (preferência do dono)
add('adesivo-sombra','<div style="position:absolute;left:30px;top:1440px;width:600px;height:180px;border-radius:90px;background:radial-gradient(closest-side,rgba(4,8,20,.6),rgba(4,8,20,.36) 60%,rgba(4,8,20,0));filter:blur(6px)"></div>')
add('adesivo-previa','<div style="position:absolute;left:110px;top:1482px;height:96px;padding:0 34px;border-radius:24px;background:#fff;display:flex;align-items:center;gap:14px;font-weight:700;font-size:38px;color:#3B6FE0;box-shadow:0 6px 20px rgba(0,0,0,.25)">🔗 SIMULAÇÃO</div>')
# marca d'água: só o "M", 48 px, 30%
add('marca-m',f'<img src="{SYM}" style="position:absolute;left:0;top:0;height:48px;opacity:.3">')
open('textos.html','w').write(f'<!doctype html><html><head><meta charset="utf-8">\n<meta name="fontes" content="family=Open+Sans:wght@400;600;700;800">\n<!-- GERADO por gerar-textos.py — edite lá. -->\n<style>{css}</style></head><body>\n'+'\n'.join(secs)+'\n</body></html>')
json.dump(idx,open('indice.json','w'),indent=0); print(len(secs),'camadas')
