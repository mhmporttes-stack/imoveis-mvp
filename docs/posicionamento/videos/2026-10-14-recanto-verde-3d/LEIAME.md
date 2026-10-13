# TESTE de estilo novo — Recanto Verde 3D + mapa (2026-10-14)

Pedido do dono: "evoluir além de transições". Vertical 1080×1920, 23,6 s, sem áudio.
- **Mapa animado com dado real (OpenStreetMap, © OpenStreetMap na tela):** rota de carro até o Centro (Catedral, ~12 min) e o Marília Shopping (~8 min); voo até o condomínio; a pé até a Escola Mário Covas (Rua Manoel Pinheiro Mattos, 840; ~7 min) e o mercado da esquina (local enviado pelo dono por link do Google Maps; 252 m, ~3 min). Tempos = roteadores OSRM/FOSSGIS (estimativa) — confirmar com o dono antes de publicar.
- **Efeito 3D nas fotos reais da incorporadora:** profundidade estimada por IA (Depth Anything V2 small, Apache-2.0, roda local) e câmera "entrando" no cômodo; o imóvel não é alterado, só o ponto de vista.
- **Legenda cinética palavra a palavra** (estilo Reels) só com fatos confirmados: casa nova/pronta, "Sai do aluguel direto pra cá", 2 quartos térrea não geminada, entrada em até 72x.
- Adesivo de link embaixo à esquerda; "M" 48 px em lugar diferente por cena; fecho com textos mais altos (preferências de 2026-10-14).
- Imagens aéreas: o Drive enviado não tem — pedir ao dono.
- Montagem: `gerar-textos.py` → `renderizar-textos.mjs textos.html --saida <camadas>` → `montar-video.py <fotos-drive> <camadas> <pasta-mapa> <modelo.onnx> <saida.mp4>` (a pasta do mapa tem os mosaicos de tiles e rotas, gerados fora do repo).
