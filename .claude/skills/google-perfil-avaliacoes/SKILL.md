---
name: google-perfil-avaliacoes
description: "Auditoria do Google Meu Negócio/Maps e avaliações, com rascunho de respostas. Use para \"veja minhas avaliações\", \"responda esta avaliação\". Nada muda sem aprovação."
---

# Google Meu Negócio, Maps e avaliações

Agente: `marketing-posicionamento`. Etiquetas e falsificabilidade: `../auditar-posicionamento/references/metodologia.md`.

## Acesso (diga o que não conseguiu)
Google Maps não é bem lido por WebFetch. Fontes, em ordem: (1) **prints/exports do dono** (painel de Desempenho, lista de avaliações, informações do perfil); (2) **Chrome do dono**, só com autorização dele nesta sessão e só **leitura**; (3) buscas públicas (amostra). Sem fonte = **[A CONFIRMAR]**, nunca número inventado.

## Auditoria do perfil (checklist com evidência)
- Reivindicado/verificado; **nome** exatamente o da marca (sem palavra-chave extra — risco de suspensão); categoria principal (ex.: "Corretor de imóveis") e secundárias reais; área de atuação (Marília e região, se atende sem balcão aberto ao público: endereço oculto vs. visível — decidir conforme o dono atende cliente no local, **A CONFIRMAR**).
- Descrição (750 caracteres): posicionamento "primeiro imóvel", MCMV, Caixa, Marília, CRECI — sem promessa de aprovação.
- Serviços (primeiro imóvel, simulação de financiamento, imóveis na planta…), produtos/imóveis em destaque, atributos, horário, telefone/WhatsApp, link do site com UTM `utm_source=google&utm_medium=organic&utm_campaign=gmn` (para o CRM atribuir).
- Fotos/vídeo (recência, qualidade, pessoas reais, empreendimentos), posts (frequência, CTA), perguntas e respostas (cadastrar as 5–8 perguntas reais de primeiro comprador e responder).
- Desempenho: pesquisas que levam ao perfil, ações (ligar, rota, site, mensagens) — compare com `HISTORICO.md`.

## Avaliações
1. Levante: nota média, total, últimos 90 dias, % respondidas, tempo médio de resposta, avaliações sem resposta (priorize as de 1–3 estrelas).
2. Temas recorrentes (o que clientes elogiam/criticam) — citando trechos curtos como evidência; sem nome de cliente em material externo.
3. **Rascunhos de resposta** (pt-BR, humanos, curtos, sem repetir modelo): agradecer pelo detalhe específico, reforçar o posicionamento de forma natural (ex.: "primeiro imóvel"), nunca expor dado do atendimento (valor, renda, aprovação, documento) — LGPD. Avaliação negativa: reconhecer, oferecer canal privado, sem discutir em público. Avaliação suspeita/falsa: preparar contestação pelo próprio Google, sem retaliar.
4. **Pedido de avaliação (ético)**: mensagem curta com link direto de avaliação, enviada **a todos** os clientes ao final do atendimento/entrega de chaves (nunca só aos satisfeitos — é gating, proibido), sem brinde ou troca. O envio por WhatsApp real exige aprovação do dono e respeito a `do_not_contact`; **não** dispare pelo CRM sem pedido explícito.
5. Entregue cada resposta/pedido como texto pronto, numerado. **Não publique sem "sim" do dono para aquela ação.** Com o "sim", aplique pelo protocolo de escrita do agente (`reply_to_review`, `create_local_post`, `upload_media`, `update_location` etc.): ler o antes, mostrar o texto exato, executar uma vez, reler e registrar. Q&A do perfil, excluir/denunciar e envio de pedido de avaliação por WhatsApp continuam com o dono (fora do alcance da integração).

## Saída
Placar GMN e Reputação (0–10 cada, com a evidência), lista de lacunas priorizada, rascunhos prontos, e atualização de `HISTORICO.md`/`BACKLOG.md`.

## Dados reais primeiro (Windsor)
Fonte 1: conector **Google Business Profile** do Windsor (`references/windsor.md` em `/auditar-posicionamento`): pesquisas, visualizações, ações e avaliações que ele expuser, com período e comparação. O que o conector não trouxer (texto das avaliações, perfil, perguntas) → print do dono ou Chrome autorizado; sem fonte = **[A CONFIRMAR]**. Use `review_id`/`post_id` do próprio `get_data` para as ações de escrita aprovadas.
