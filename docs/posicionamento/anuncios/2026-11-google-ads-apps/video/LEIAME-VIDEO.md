# Vídeos curtos, Google Ads em apps (2026-11)

Sem áudio (apps tocam mudos), legendas na imagem, 30 fps, H.264 MP4, todos < 3 MB. Cenas: gancho "Quer sair do aluguel?" -> foto real "Descubra seu poder de compra" -> "em menos de 2 minutos" -> fecho parado (botão "Simular Agora", símbolo, nome oficial, "Simulação grátis e sem compromisso"). O fecho dura ≥ 3,9 s e o último quadro está em PNG (`ultimo-quadro-<formato>.png`, serve de imagem estática). Fotos: interiores do COD4354 (Palmital, publicado no site), sem número de casa, sem preço. Matheus: só as fotos reais do repositório (recortes de `bracos-cruzados` e `apontando`); nenhuma imagem de pessoa gerada por IA.

## Versões (para teste A/B)
| Versão | O que é | Duração |
|---|---|---|
| A | Só imóvel (controle) | 13,5 s |
| B | Abre com Matheus de braços cruzados entrando (deslize) sobre fundo da marca, junto do gancho "Quer sair do aluguel?" | 13,5 s |
| C | Matheus aponta para "Descubra seu poder de compra" (cena 2, sobre a foto do imóvel) | 13,5 s |
| D | Abertura de 2 s com Matheus e o nome, depois a sequência A | 15,0 s |

Arquivos: `video-<1x1|9x16|16x9>-<A|B|C|D>.mp4` (1080×1080, 1080×1920, 1920×1080) = 12 vídeos. Regerar: `node docs/posicionamento/anuncios/2026-11-google-ads-apps/video/_fonte/gerar-videos.mjs <A|B|C|D>` (precisa de ffmpeg e ImageMagick).

## Como subir
O Google Ads só aceita vídeo vindo do YouTube. No canal do dono: enviar cada MP4 como **Não listado**, copiar o link e colar no anúncio de vídeo / ativo de vídeo da campanha. O Google pode redimensionar, cortar ou recompor os formatos (por isso texto fica ≥10% longe das bordas). Nada foi enviado ou publicado.

## Como testar (mesmo orçamento)
1. Criar um anúncio (ou grupo de anúncios) por versão, com o mesmo público, verba diária igual e as mesmas datas.
2. Cada anúncio com link próprio usando `utm_content=video-A`, `video-B`, `video-C`, `video-D` (gerador de links do CRM) para os cadastros de simulação identificarem a versão.
3. Deixar rodar o mesmo período (ideal ≥ 7 dias e ≥ 30 cliques por versão antes de concluir) e comparar o **custo por cadastro** por `utm_content`; secundário: taxa de visualização (VTR) e CTR.
4. Manter a vencedora e testar nova variação contra ela.

Revisão: quadros-chave de cada formato conferidos (legibilidade, margens, baseline do texto). Avaliação do `design-critic`: agente não disponível nesta sessão, fica pendente.
