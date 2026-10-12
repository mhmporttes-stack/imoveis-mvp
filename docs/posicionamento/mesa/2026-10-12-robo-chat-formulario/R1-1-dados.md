# Rodada 1 — Cadeira Dados do CRM (Versão 1)

Período: conversas criadas 24/09–12/10/2026 (America/Sao_Paulo), sem as apagadas. Fonte: Supabase (somente leitura).

## Diagnóstico
- Robô hoje só no número **Oficial**, e na prática só para **anúncio**. Anúncio: 25 conversas → 22 receberam link (mediana 21 s) → 19 lidos → **9 preencheram (41 %; IC 23–61 %)**, mediana 5 min, 6/9 em ≤ 1 h. Com as 28 conversas apagadas em 09/10: 11/32 (34 %).
- Dos 13 que não preencheram: 6 silêncio, **7 responderam** (4 com áudio, que o robô não trata). Temas: "como funciona/que formulário" (2), Pompéia/outra cidade (2), "já fiz" sem formulário no CRM (1), valor da parcela (1), "negativado, não vou ser aprovada" (1), "tô no trabalho" (1).
- Entre quem preencheu: "tenho restrição, como funciona?", "o que é blindagem?", "quais documentos?" — dúvida respondida não impede.
- 1ª resposta humana (anúncio): 23/25, mediana 14 min, P75 > 8 h; 8/25 começaram fora de 8h–19h.
- Lembretes WA-17 desde 09/10: 13 para 6 conversas (1h:5, 3h:4, 10h:3, 23h:0); 2 preencheram depois de lembrete. n pequeno.
- Fluxo "Anúncio WhatsApp — formulário direto": 49 sessões, 100 % "handoff" — saudação + texto + link e encerra, sem pergunta. "Contato espontâneo — saudação": 3. **"TESTE anúncio" ativo em produção.** Palavras-chave: todas inativas. Disparo: sem automação em 60 dias.
- WhatsApp individual dos corretores: 0 envios automáticos; 111 clientes novos escreveram primeiro, resposta humana ~1 min, 84 arquivados (muitos não são lead).

## Premissas questionadas
1. A perda não é "não preenche": é **quem responde com dúvida/áudio e fica sem resposta** (7/13). Solução: responder na hora e reenviar o link.
2. "Robô para todo contato": no número do corretor já se responde em ~1 min — **não colocar robô lá**.
3. 4 lembretes sem base (23h nunca saiu).
4. "Já fiz" falso: outro telefone ou confundiu link.

## Versão 1 — proposta
**Anúncio (Oficial)**
1. 0 s: "{{saudacao}}, {{primeiro_nome}}! Aqui é da equipe do Matheus Machado. Pra eu te mostrar quanto você consegue de financiamento, preciso de umas respostas rápidas (leva uns 2 minutos)." + link "Fazer minha simulação" + botões [Já vou preencher] [Tenho uma dúvida antes] [Prefiro falar com uma pessoa].
2. Sem handoff imediato: sessão espera até preencher.
3. Cliente escreve → resposta por tema (uma vez, curta, sempre com link):
   - como funciona/que formulário → "É um cadastro rápido com renda e família. Com ele o corretor calcula o valor do imóvel, da entrada e da parcela que cabem pra você." + link
   - parcela/valor → "O valor depende da sua renda e da sua família — é exatamente o que o formulário calcula." + link
   - nome sujo/negativado/restrição → "Pode preencher tranquilo: ter restrição não impede de fazer a simulação. O corretor te explica, sem compromisso, quais caminhos existem." (sem prometer aprovação)
   - "já fiz" sem formulário no CRM → "Não encontrei aqui — talvez tenha ido com outro número. Pode tentar por este link?" → senão atendente
   - outra cidade → DECISÃO DO DONO
   - áudio/imagem/"falar com pessoa"/tema não reconhecido → "Recebi! Já chamei um corretor pra te responder." + notifica corretor com prioridade + link "se quiser adiantar".
4. Preencheu → pós-formulário (§9-A) + corretor.
5. Lembretes: manter 1h e 3h; trocar 10h/23h por um às 20h ("Muita gente acha que não consegue por causa da renda ou do nome. A simulação mostra o que é possível pra você."); parar lembrete se há pergunta sem resposta.

**Orgânico (Oficial):** 1ª mensagem → saudação + [Quero fazer minha simulação] [Já sou cliente] [Tenho uma dúvida]; simulação segue o caminho do anúncio.
**Número do corretor:** sem robô. **Disparo:** desenhar quando houver dado.

**Métrica:** principal = % conversas de anúncio com formulário em ≤ 24 h (base 41 %, 9/22). Secundárias: % de quem escreveu/áudio sem preencher respondido em ≤ 5 min; % silêncio pós-link; mediana até formulário. Antes × depois com ≥ 30 conversas cada (~3–4 semanas por período).

## Para a próxima cadeira (Atendimento humanizado)
Tom e texto final; "nome sujo" sem prometer; robô se apresenta como pessoa ou assistente?; corretor assumindo fora do horário (8/25). Decisão do dono: outra cidade.
