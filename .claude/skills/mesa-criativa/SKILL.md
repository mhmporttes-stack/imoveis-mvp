---
name: mesa-criativa
description: "Mesa de Criação: até 5 especialistas (carrossel/design, tráfego, WhatsApp/automação, atendimento humanizado, dados do CRM) melhoram a MESMA ideia em rodadas, um rebatendo o outro, com pesquisa de Marília e do público, até um resultado final pronto para o dono aprovar. Use para \"mesa de criação\", \"quero que os agentes discutam\", campanha/carrossel/anúncio/cadência que precise de várias visões. Demora mais; não publica nada."
---

# Mesa de Criação (pedido do dono, 2026-10-12)

Origem: o dono passou um carrossel 3 vezes entre o criador de carrossel e o gestor de tráfego, sempre pedindo para
pesquisar Marília e o público e questionar as decisões do outro, e o resultado ficou excelente para patrocinar. Esta
skill automatiza esse vai-e-volta. **Qualidade > velocidade**: o dono aceita que demore.

## A mesa (máx. 5 cadeiras — escolha as que a ideia pede; padrão = as 5)

| # | Cadeira | Agente (`subagent_type`) | Lente / pergunta que sempre faz |
|---|---|---|---|
| 1 | **Criação e design** (carrossel, post, anúncio visual) | `marketing-posicionamento` + skill `/carrossel` (fotos e boneco do Matheus em `docs/posicionamento/assets/`) | Para o olho em 1 s? Texto fiel, visual no padrão, gancho forte? |
| 2 | **Tráfego pago** | `gestor-trafego` (somente leitura; nunca altera a Meta) | Para o polegar de quem? Público, objetivo, CTA, criativo que vende, custo por lead; dados reais de campanhas |
| 3 | **WhatsApp e automação** | `diretor-atendimento` (lente: WhatsApp Oficial/pessoal, Fluxos, cadência, roleta, regras WA-*) | O que acontece no 1º minuto depois do clique? A conversa chega pronta, com o link/formulário certo? |
| 4 | **Atendimento humanizado** | `diretor-atendimento` (lente: especialista em atendimento humanizado — empatia, linguagem do comprador do 1º imóvel, objeções, confiança) | Isso soa como gente? Acolhe medo/vergonha de "nome sujo", renda informal, primeira compra? |
| 5 | **Dados do CRM / voz do cliente** | `analista-dados` (somente leitura) | O que os números reais dizem (origem que converte, horário, objeção, perfil de renda, Marília)? A ideia bate com quem realmente compra? |

Cadeira opcional que pode substituir uma das 5 quando a ideia pedir: `email-specialist` (e-mail),
`designer-crm` (tela/PDF/apresentação do CRM), `crm-editor` (quando a ideia vira implementação no sistema).

## Como rodar

1. **Brief** (você, sessão principal): registre em 5–10 linhas a ideia do dono, objetivo de negócio, público, canal,
   restrições e o que ele já disse. Se faltar algo essencial que só o dono sabe, pergunte UMA vez; senão, siga.
2. **Rodadas — mínimo 3 rodadas completas** (cada rodada = todas as cadeiras escolhidas, em sequência; nunca em
   paralelo, porque cada uma recebe o trabalho da anterior). Cada agente recebe:
   - o brief, a **versão atual** (íntegra) e o **histórico resumido** das críticas anteriores (quem pediu o quê e por quê);
   - a instrução fixa:
     > Você é a cadeira **{cadeira}** da Mesa de Criação. (a) Pesquise o que for preciso (Marília/SP, comprador do
     > primeiro imóvel, MCMV, concorrentes, dados do CRM ao seu alcance) — cite a fonte. (b) **Questione pelo menos 2
     > decisões** das cadeiras anteriores, com motivo; concorde só com justificativa. (c) Entregue a **versão melhorada
     > completa** (não só comentários) + lista "o que mudei e por quê" (≤ 8 itens) + "o que deixo para a próxima cadeira
     > decidir". Respeite as regras do projeto e a identidade visual (CLAUDE.md regra 10). Não publique, não envie, não
     > altere campanha, banco ou código. Português simples; ≤ 60 linhas fora a versão.
   - Na 2ª rodada em diante, cada cadeira precisa responder às objeções feitas contra a versão dela na rodada anterior.
3. **Convergência:** depois da 3ª rodada, se ainda houver divergência forte entre duas cadeiras, faça uma 4ª rodada só
   com elas (no máx. 2 rodadas extras). Não arbitre gosto pessoal: registre as duas opções para o dono.
4. **Material final:** se for carrossel/post, a cadeira 1 produz os PNGs pela `/carrossel` (fotos do dono e boneco 3D já
   existem; imagens do Canva pelo design auxiliar). Se for campanha paga, o gestor-trafego entrega a especificação
   PAUSADA (`/planejar-campanha`). Se virar mudança no CRM (fluxo, automação, tela), entregue como **Especificação** para
   o `crm-editor` — só implementa com "sim" do dono.
5. **Dossiê:** grave em `docs/posicionamento/mesa/AAAA-MM-DD-<tema>/DOSSIE.md`:
   brief · versão final · tabela das rodadas (cadeira → principais mudanças) · decisões em aberto para o dono ·
   próximos passos · arquivos gerados. Commit só desse diretório (e dos PNGs), push na main (doc não publica o site).
6. **Resposta ao dono** (≤ 30 linhas, linguagem simples): o resultado final, as 3–5 mudanças que mais pesaram e por
   qual cadeira, o que ele precisa decidir, e os arquivos (mande os PNGs pelo SendUserFile).

## Regras que não mudam
- Nada é publicado, enviado, impulsionado ou alterado em produção sem "sim" do dono para aquela ação.
- Agentes analíticos (`gestor-trafego`, `analista-dados`) são somente leitura — não contorne.
- Nunca invente número, depoimento, aprovação de crédito ou promessa ("aprovação garantida", "sem entrada" sem regra).
- Mantenha cada cadeira na sua lente; quem decide gosto final e verba é o dono.
- Custo: ~15 chamadas de agente por ideia (5 cadeiras × 3 rodadas). Avise o dono se a ideia pedir mais.
