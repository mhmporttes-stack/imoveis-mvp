# Brief — Mesa: fluxo do patrocinado + roleta com oferta por WhatsApp (2026-11-10)

Objetivo: o dono quer que as cadeiras critiquem, rebatam e melhorem em rodadas o desenho abaixo até uma versão final para ele aprovar. Não implementar nem enviar nada.

## Desenho do dono (texto original, condensado fielmente)

**1. Contexto.** Matheus Machado, corretor em Marília/SP (1º imóvel, MCMV). CRM próprio multiusuário (admin, gestor, corretor, associado). Número OFICIAL na WhatsApp Cloud API (anterior banido pela Meta em 28/09; novo ativo desde 12/10, chaves sendo reinseridas). Cada corretor conecta o WhatsApp pessoal ao CRM (não oficial, Baileys, até 2 números). Hoje o anúncio cai no CRM como cliente em "Atendimento automático", segurado com o dono; só entra na roleta quando o cliente responde ou preenche o formulário. Já existem Fluxos do oficial, roleta de leads, link de simulação e link de apresentação da simulação.

**2. Fluxo do patrocinado (Click-to-WhatsApp)** — cliente chega com "gostaria de mais informações".
1. Saudação Bom dia (até 11:59)/Boa tarde (até 17:59)/Boa noite; se o 1º nome do perfil for claramente feminino/masculino, "minha amiga"/"meu amigo"; ambíguo/apelido/emoji/sem nome → só o nome ou nada. Depois, 3 botões: Localização | Valores | Falar com um associado.
2. Localização: imagem do empreendimento com botão "Google Maps" (interativa com imagem e link). Abaixo, de novo Valores e Falar com um associado.
3. Valores: link "Descubra seu poder de compra", que abre direto nas perguntas da simulação, sem nome/telefone quando o WhatsApp trouxe o nome (telefone sempre vem). Sem nome → pergunta só o nome.
4. Pós-cadastro: se enquadra no MCMV, ao concluir o cadastro e o card receber os dados, envia automaticamente o link de apresentação da simulação com Ecovillage e Terras de SP como sugeridos.
5. Cutucada: >2 min parado em qualquer etapa → uma única mensagem contextual (ex.: "Ana, ficou alguma dúvida sobre a localização?"). Sem resposta por mais 3 min → transferência.
6. Atalhos: botão "Falar com um associado" e qualquer texto livre param o fluxo e iniciam a transferência na hora.

**3. Distribuição (roleta própria do anúncio).**
- Participantes: Gabriel, Dienifer e Caroline Mayumi. Tela de config (admin/gestor) para adicionar/remover, ligar/desligar e ordenar.
- Toda transferência = oferta no WhatsApp do próximo da roleta, dia ou noite, do número OFICIAL para o WhatsApp particular do corretor: "Tem um cliente aguardando, você é o próximo da roleta. Está disponível para atender? Responda sim ou ok."
- 1 minuto por corretor. "Sim"/"ok" (e variações) em 1 min → cliente transferido. Sem resposta → próximo, e assim por todos os ativos.
- Ninguém aceitou: fora do horário (20:00–07:00) cliente recebe "um associado entra em contato a partir das 8:00". Durante o dia (07–20) NÃO manda; interpretação provisória: segue pela roleta normal, segurado com o dono, e o corretor da vez recebe o aviso normal. (Criticar.)
- Resposta tardia: A perdeu a vez e responde enquanto a oferta está com C → A recebe "deixa eu verificar se o cliente ainda está disponível"; se C não responde em 1 min, vai para A; se C responde, vai para C e A recebe "não está mais disponível". Vários tardios → ordem da roleta. Tardia depois de todos passarem: sem responsável → quem respondeu; já foi para outro → "não está mais disponível".
- Os "3 minutos" são só exemplo.
- Generalização: mesma oferta por WhatsApp sempre que um corretor for o próximo da roleta GERAL e houver lead; interruptor separado, desligado (roleta geral em produção).

**4. Avisos por WhatsApp.** Push e sino continuam; WhatsApp pelo oficial é adicional. Função única "alerta pelo oficial", reaproveitável para estrutura completa de avisos.

**5. Janela de 24 h.** O oficial só manda texto livre ao corretor dentro da janela aberta pela última mensagem DELE ao oficial. Sem modelo (template) da Meta por enquanto. Por isso:
- Todo dia 08:00 o WhatsApp pessoal de cada corretor conectado envia ao oficial "Bom dia, já estou disponível para atender".
- Corretores conferem diariamente; se não saiu, mandam qualquer coisa à mão.
- Apoio: sistema confere se chegou; se faltar, reenvia "oi"/emoji (até 2x), alerta o dono se falhar e mostra lista "Bom dia de hoje".
- Mensagem de número da equipe no oficial nunca vira cliente nem dispara fluxo.

**6. Pedido.** (1) furos/riscos Meta: janela 24 h, janela gratuita 72 h de anúncio, botões interativos, limite de 3 botões, política, banimento do oficial e do pessoal, mensagens automáticas dos pessoais, janela expirar às 08:00, bom dia falhar; (2) bordas: cliente que clica em tudo, texto no meio, cliente que some, dois aceitando juntos, corretor sem sessão, feriado/domingo, cliente repetido, já cadastrado; (3) conversão: textos, ordem dos botões, 2 e 3 min cedo demais?, o que mais reduz perda; (4) experiência do corretor: 1 min basta? aviso demais, ignorar, injustiça, medir aceite; (5) alternativa template Meta como reserva e custo; (6) métricas; (7) interpretações a confirmar.

Entrega final: versão única melhorada, lista priorizada de mudanças, dúvidas do dono, riscos sem solução limpa.

## Restrições do projeto
Nada enviado/publicado; nunca contato a `do_not_contact`/bloqueado; nome "Matheus Machado Corretor de Imóveis"; regras de WhatsApp em `.claude/rules/integracoes-externas.md` e `docs/WHATSAPP.md` (WA-*), roleta em `.claude/rules/roleta-prospeccao-campanhas.md`; a IA nunca envia nada por conta própria.
