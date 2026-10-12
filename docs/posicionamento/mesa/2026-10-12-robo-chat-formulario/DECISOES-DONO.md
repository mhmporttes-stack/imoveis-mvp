# Decisões do dono durante a mesa (2026-10-12)

1. **Fluxo "TESTE anúncio":** NÃO desativar (fica como está).
2. **Outra cidade:** atender pessoas de outras cidades **desde que queiram comprar em Marília**. (B9 deve perguntar/confirmar se a pessoa quer comprar em Marília.)
3. **"Pare"/"não me mande mais":** o robô **marca "Não contactar" sozinho**.
4. **"Assistente virtual":** NÃO. O robô não se apresenta como assistente virtual. (Sem se dizer robô — e também sem afirmar ser pessoa; falar como "equipe do Matheus Machado Imóveis". Mensagens que diziam "como sou assistente virtual, não consigo ouvir" precisam de outro texto.)

5. **Horário:** padrão é segunda a sábado, 8h–19h, **mas** se o cliente não consegue nesse horário a equipe atende em outro horário combinado (o link já deixa isso claro). Mensagens fora do horário devem dizer isso (ex.: "se esse horário não der pra você, a gente combina outro").
6. **Lembrete de 23 h do anúncio:** cortar (altera WA-18 → sequência 1 h / 3 h / 10 h). Registrar como regra nova na implementação (`/registrar-regra`).
7. **Número oficial:** o antigo foi banido em 28/09; o dono **comprou um número novo**, que é o Oficial ativo hoje (é por ele que o robô roda).
8. **Lembrete de madrugada:** SIM — lembrete que cairia de madrugada (21h–8h) fica para as 8 h (desfaz o "roda 24 h" de 09/10 só para isso; registrar com `/registrar-regra` na implementação).
9. **Carrossel Eco Village (7 conversas na Meta, 0 no CRM):** o anúncio apontava para o **WhatsApp particular do dono**, não para o Oficial — por isso não há conversa com ID no CRM. Não é falha de rastreamento.
10. **Grupo do silêncio (não responde nem preenche, fica com o dono pela WA-18):** **transferir para a roleta** (um corretor assume e faz o toque humano). Momento exato (ex.: depois do último lembrete sem resposta) a definir pela mesa; altera a WA-18 → `/registrar-regra` na implementação.
11. **Guia de Atendimento:** aprovado incluir a entrada "Lead de anúncio: primeira resposta (texto ou áudio)" com o roteiro M1–M5 (`R2-2-humanizado.md`), na implementação.
12. **Dono aprovou as recomendações da mesa ("faça do seu jeito, aprovado"), em 2026-10-12:**
    - Silêncio vai para a roleta **junto com o lembrete de 3 h** (opção A); se cair entre 21h e 8h, às 8 h.
    - Resposta fora do horário: **uma vez por período fechado** (noite / fim de semana), com as travas da V8.
    - **Intervalo mínimo de 2 h** entre lembretes.
    - Cliente de outra cidade que não quer Marília: a mesa escolhe. Critério: sair da roleta e da REDISTRIBUIÇÃO **sem perder o contato se ele voltar a escrever** (atenção: WA-13 — conversa de cliente arquivado não volta ao Chat; não usar "Não contactar", que é só para quem pediu). Definir na rodada 3.
