# Pacote Google Business Profile — rascunhos prontos (2026-10-02)

> Status: **NADA APLICADO.** Cada item abaixo precisa do "sim" do dono, por ação (`.claude/agents/marketing-posicionamento.md`, "Alterações externas"). Antes de aplicar, reler o estado atual (`get_data`) e o esquema da ação (`list_actions` — bloqueado pela trava da sessão em 2026-10-02: precisa liberar).
> Perfil: `locations/11870750752232851669` ("Matheus Machado"). Fonte do "antes": Windsor 2026-10-02 e Google Maps público.

## ✅ ETAPA 1 APROVADA E **PUBLICADA em 02/10** (6 respostas + descrição + link; ver `HISTORICO.md`). Itens §3–§9 abaixo seguem **pendentes de aprovação**. Textos FINAIS (substituem §1 e §2):
Bloqueio: "Write actions are disabled for the Windsor user" (configuração do dono em Windsor → Settings → API Access → "Enable write actions for Claude, ChatGPT & API"). Aguardando o dono ligar; nenhuma alteração foi feita no Google. Estado "antes" (02/10): descrição antiga (abria com "Especialista na compra do primeiro imóvel em Marília e região… até a aprovação do financiamento…"), site `https://www.matheusmachadoimoveis.com.br/` sem UTM, 0 respostas.

**Descrição final (538/750):** Especialista na compra do primeiro imóvel em Marília/SP. Sou Matheus Machado, corretor de imóveis (CRECI 323106), e ajudo você a sair do aluguel: simulação de financiamento pela Caixa, Minha Casa Minha Vida, análise de renda (formal e informal) e acompanhamento de todas as etapas, da escolha do imóvel até a assinatura do contrato. Trabalho com imóveis na planta, novos e usados em Marília e região, com atendimento transparente e sem enrolação. Faça a simulação da sua entrada, sem compromisso, e descubra qual imóvel cabe no seu bolso.
**Site final:** `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn` (ação `update_location`, campos `description` e `website_url`; telefone inalterado).

**Respostas finais (`reply_to_review`; individuais, sem dado do atendimento):**
- Bruna Vitória: "Bruna, que alegria saber que o seu primeiro imóvel virou realidade! Obrigado pelo carinho e por confiar em mim. Muita felicidade no novo lar!"
- Maria Eduarda Bencke: "Maria Eduarda, muito obrigado pelas palavras! Fico feliz por ter ajudado você a comprar o primeiro imóvel, e vou estar por aqui nos próximos passos também. Sucesso sempre!"
- Luana Souza: "Luana, obrigado pelo retorno! Fico muito feliz que você tenha encontrado o imóvel que sonhava. Parabéns pela conquista!"
- Ketlin Santos: "Ketlin, valeu demais pelo carinho! Fico muito feliz com a sua avaliação. 🚀"
- Eduardo Gabriel: "Eduardo, obrigado pela avaliação! Que bom que você gostou do atendimento. Sempre que precisar, estou por aqui."
- Caroline Mayumi Nagaishi (sem texto): "Caroline, obrigado pelas cinco estrelas e pela confiança no meu trabalho. Foi um prazer atender você!"
(`review_id` de cada uma: reler com `get_data` no momento de aplicar.)

---

## 1. (RASCUNHO ORIGINAL, superado) Respostas às 6 avaliações (`reply_to_review`) — risco baixo, público
Tom do dono; sem dado do atendimento, sem promessa, sem pedir nova avaliação. IDs completos ficam no `get_data` (campo `review_id`) no momento da aplicação.

| Autor | Estrelas | Texto da avaliação (resumo) | Resposta proposta |
|---|---|---|---|
| Bruna Vitória | 5 | "Equipe excelente… me ajudaram na compra do meu primeiro imóvel… tiraram todas as dúvidas" | "Bruna, parabéns pela conquista do seu primeiro imóvel! Foi um prazer acompanhar cada etapa e esclarecer todas as suas dúvidas. Desejo muitas alegrias na casa nova! — Matheus Machado" |
| Maria Eduarda Bencke | 5 | "Profissional maravilhoso… comprei meu primeiro imóvel com ele e pretendo comprar os próximos" | "Maria Eduarda, muito obrigado pela confiança e pelas palavras! Fico feliz de ter ajudado na realização do seu primeiro imóvel. Pode contar comigo sempre. — Matheus Machado" |
| Luana Souza | 5 | "Equipe muito boa… me ajudou achar o imóvel dos meus sonhos" | "Luana, obrigado! Que bom saber que você encontrou o imóvel que combina com o seu sonho. Parabéns pela conquista! — Matheus Machado" |
| Ketlin Santos | 5 | "Top demais" | "Ketlin, muito obrigado pelo carinho! Fico muito feliz com o seu feedback. — Matheus Machado" |
| Eduardo Gabriel | 5 | "Muito bom, amei o atendimento" | "Eduardo, obrigado pela avaliação e pela confiança! Foi um prazer atender você. — Matheus Machado" |
| Caroline Mayumi Nagaishi | 5 | (sem texto) | "Caroline, obrigado pelas 5 estrelas e pela confiança! Foi um prazer atender você. — Matheus Machado" |

## 2. Descrição e link do site (`update_location`) — risco baixo, público; Google pode revisar
**Antes (resumo):** descrição abre com a frase certa, mas sem CRECI e com "até a aprovação do financiamento" (pode soar como promessa); link do site sem UTM.
**Depois (491 de 750 caracteres):**
> Especialista na compra do primeiro imóvel em Marília/SP. Ajudo você a sair do aluguel: simulação de financiamento pela Caixa, Minha Casa Minha Vida, análise de renda (formal e informal) e acompanhamento de todas as etapas, da escolha do imóvel até a assinatura do contrato. Trabalho com imóveis na planta, novos e usados em Marília e região, com atendimento transparente e sem enrolação. Faça a simulação da sua entrada sem compromisso e descubra qual imóvel cabe no seu bolso. CRECI 323106.

**Link do site:** `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=google&utm_medium=organic&utm_campaign=gmn` (o CRM registra a origem como "Link — gmn"; `lib/lead-origin.js`).
Telefone permanece `(14) 99840-7380` (igual ao site). **Não alterar nome** ("Matheus Machado": nome real, sem palavra-chave — regra do Google).

## 3. Serviços (`update_service_items`) — SUBSTITUI a lista inteira; precisa da sua confirmação do que você realmente faz
Hoje são 23 itens estruturados. Proposta:
- **Manter (relevantes ao posicionamento):** serviços para quem compra o primeiro imóvel (`first_time_home_buyer_services`), serviços de agente de compra (`buying_agent_services`), imóvel à venda (`property_for_sale`), apartamentos (`apartment`), casas (`houses`), imóveis novos (`new_real_estate`, `new_construction`), na planta (`off_plan_properties`), empreendimentos (`developments`), serviços de agente vendedor (`sellers_agent_services`), atendimento online (`online_service`).
- **Retirar se você NÃO presta (dispersam o foco):** leilões (`auctions`), venda de fazendas e sítios (`farm_sales`, `farmsteads_and_smallholdings`), imóveis de luxo (`luxury_property_buying_and_sales`, `luxury_properties`), imóveis comerciais (`commercial_real_estate`, `commercial_properties`), avaliação (`appraisals`), administração de imóveis (`real_estate_management`), investimento imobiliário (`real_estate_investment`), terrenos/lotes (`building_lots_for_sale`, `plots_of_land`).
- **Adicionar (itens livres, em português):**
  1. "Simulação de financiamento imobiliário" — "Simulo sua entrada e parcelas antes de você visitar qualquer imóvel."
  2. "Minha Casa Minha Vida" — "Explico em qual faixa de renda você se encaixa e conduzo o processo."
  3. "Financiamento pela Caixa" — "Acompanho a documentação e as etapas, da simulação à assinatura."
  4. "Compra do primeiro imóvel" — "Orientação completa para quem vai comprar a primeira casa ou apartamento."
**REVISÃO 02/10 (aguardando aprovação do dono):** manter 11 (primeiro imóvel, agente de compra, agente de venda, imóvel à venda, apartamentos, casas, imóveis novos ×2, na planta, empreendimentos, atendimento online); remover 12 (administração, avaliação, comercial ×2, luxo ×2, fazenda, sítios, leilão, investimento, terrenos ×2); adicionar 4 itens livres em pt-BR com `category_id` = `gcid:real_estate_agents` (categoria principal atual). Evidência: página `/venda-seu-imovel` no site (justifica manter agente de venda); só 5 de 153 posts do Instagram falam de terreno; nenhum conteúdo sobre leilão, rural, comercial, luxo ou avaliação.
**Informado pelo dono (02/10):** área de atendimento = somente Marília/SP; os 112 pedidos de rota = clientes/interessados indo ao escritório.

## 4. Categorias (`update_categories`) — SUBSTITUI; pode pedir reverificação
Hoje: principal "Agente imobiliário"; adicionais: nenhuma. Proposta: manter "Agente imobiliário" como principal e **adicionar uma categoria adicional que descreva o negócio real** (candidata: "Consultor imobiliário"). O ID exato da categoria e se está disponível em pt-BR: **A CONFIRMAR** (precisa do esquema de `update_categories`). Não adicionar categoria de financeira/correspondente bancário se você não for um.

## 5. Área de atendimento (`update_service_area`) — SUBSTITUI
Hoje: vazia. Candidatos pelas cidades do seu público no Instagram (30 dias): Marília, Garça, Vera Cruz, Oriente, Pompéia, Quintana. **Confirme quais cidades você realmente atende.**

## 6. Fotos (`upload_media`) — precisa de URL pública; você fornece as imagens
Hoje: 1 foto (14/07), 0 visualizações; sem foto de capa/perfil identificada. Meta: ≥10 fotos reais. Checklist: (1) logo ou foto de perfil quadrada com o seu rosto; (2) capa 16:9; (3) fachada/entrada da Av. Ipiranga, 147; (4) interior do escritório; (5) você atendendo; (6) você com cliente na entrega de chaves (**só com autorização escrita do cliente**); (7–9) empreendimentos que você vende; (10) equipe. Arquivos JPG/PNG ≥ 250 px. Me envie as imagens; eu hospedo em URL pública e proponho a ordem.

## 7. Publicações no perfil (`create_local_post`, `language_code=pt-BR`) — 1 por semana, botão "Saiba mais" com o link de UTM `utm_campaign=gmn_post`
**Post 1 (355 caracteres)**
> Primeiro imóvel: por onde começar?
> 1) Descubra quanto você pode financiar (renda, entrada e FGTS).
> 2) Simule antes de visitar qualquer imóvel.
> 3) Separe a documentação.
> 4) Só então escolha o imóvel que cabe na sua realidade.
> A simulação é gratuita e mostra o caminho. A análise de crédito é feita pela Caixa.
> Matheus Machado · CRECI 323106 · Marília/SP

**Post 2 (371)**
> Minha Casa Minha Vida em Marília: quem define as condições é a sua renda.
> O programa tem faixas de renda, e as condições mudam conforme a faixa e as regras vigentes. Não existe resposta única: depende do seu caso.
> Faça a simulação e eu explico, passo a passo, onde você se encaixa. A aprovação do crédito é decisão da Caixa.
> Matheus Machado · CRECI 323106 · Marília/SP

**Post 3 (375)** — *confirmar a lista com o seu atendimento real antes de publicar*
> Documentos para financiar o primeiro imóvel
> Em geral, a Caixa pede documento de identificação, CPF, comprovante de renda, comprovante de residência e certidão de estado civil. A lista exata depende do seu caso (renda informal, casado, FGTS…).
> Antes de juntar papel, faça a simulação: eu confiro com você o que realmente precisa.
> Matheus Machado · CRECI 323106 · Marília/SP

**Post 4 (266)**
> Quem já conquistou o primeiro imóvel conta como foi.
> O retorno de quem comprou com atendimento claro e acompanhamento em cada etapa é o que me move todos os dias. Quer ser o próximo? Faça a sua simulação sem compromisso.
> Matheus Machado · CRECI 323106 · Marília/SP

## 8. Perguntas e respostas do perfil — fora do alcance da integração: **você publica no painel do Google**
Perguntar e responder você mesmo é permitido pelo Google. Sugestão (5):
1. **Quanto preciso de entrada para comprar o primeiro imóvel?** — Depende do imóvel, da sua renda e das regras vigentes. Faça a simulação gratuita no site e veja uma estimativa; a análise final é da Caixa.
2. **Vocês trabalham com Minha Casa Minha Vida em Marília?** — Sim. Ajudo a verificar em qual faixa de renda você se encaixa e conduzo a simulação e as etapas do processo; a aprovação do crédito é da Caixa.
3. **Dá para comprar o primeiro imóvel com renda informal?** — Cada caso é analisado pela Caixa. Eu avalio a sua situação (renda formal e informal) e oriento a documentação.
4. **Como funciona a simulação?** — Você informa renda e dados básicos no site ou me chama; mostro entrada, parcelas e opções antes de visitar imóveis. É sem compromisso.
5. **Qual o horário de atendimento?** — Segunda a sexta, 8h–18h; sábado, 8h–12h.

## 9. Horário (`set_regular_hours`) — só se estiver desatualizado
Hoje: seg–sex 8h–18h, sáb 8h–12h. **Confirme** se atende também por WhatsApp fora desse horário e se o horário está correto.
