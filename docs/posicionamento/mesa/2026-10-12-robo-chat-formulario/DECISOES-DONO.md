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
13. **Entrada do Guia de Atendimento:** o dono autorizou ("sim") gravar direto no banco de produção a entrada "Lead de anúncio: primeira resposta (texto ou áudio)" (roteiro M1–M5 + abertura do silêncio) no guia "Lead — patrocinado". Fazer **depois da rodada 3**, com o texto final: ler o `published_graph` atual, acrescentar os nós, validar com `validateGuideGraph`/`sanitizeGuideGraph` (`lib/attendance-guide-core.mjs`) antes de gravar, atualizar `graph` e `published_graph` com nova `version`/`published_version`, e guardar o JSON anterior para desfazer.
14. **Categoria especial da campanha ativa (print do dono, 2026-10-12):** a campanha "WHATSAPP | Marilia | PATROCINADO | Video" (objetivo Engajamento, orçamento por conjunto) **não tem nenhuma categoria especial declarada** (campo "Declarar categoria se aplicável" vazio). Recomendação da mesa: o anúncio novo (H1) sai **numa campanha nova com "Moradia" declarada** (e "Produtos e serviços financeiros" se o dono entender que o anúncio é de financiamento); os requisitos por país variam — o dono decide e executa no Gerenciador.

## Execução da decisão 13 (2026-10-12)
Entrada do Guia **gravada e publicada** no banco de produção: guia "Lead — patrocinado / lead novo" (`5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b03`), versão 4/publicada 1 → **5/5**; 30 → 47 cards, 62 → 96 ligações; card `l-recepcao` com 2 respostas novas no início (12 no total). Validação local antes de gravar: `sanitizeGuideGraph` +17/+34 exatos, `validateGuideGraph` com o Banco de objeções publicado = **0 erros** (só o aviso normal de `la-retorno`). O rascunho anterior só diferia do publicado na posição de 2 cards (edição do dono em 28/09) — foi preservado e publicado junto.
- Backup do rascunho anterior: `backup-guia-lead-v4-graph.json`.
- **Desfazer** (remove só o que foi acrescentado):
```sql
update attendance_guides g set
  graph = jsonb_build_object(
    'nodes', (select jsonb_agg(case when n->>'id'='l-recepcao' then jsonb_set(n,'{data,options}',(select jsonb_agg(o) from jsonb_array_elements(n->'data'->'options') o where o->>'id' not like 'l-recepcao~la%')) else n end) from jsonb_array_elements(g.graph->'nodes') n where n->>'id' not like 'la-%'),
    'edges', (select jsonb_agg(e) from jsonb_array_elements(g.graph->'edges') e where e->>'id' not like 'e-la-%' and e->>'id' not like 'e-recepcao-la%')),
  version = version + 1, updated_at = now()
where g.id = '5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b03';
update attendance_guides set published_graph = graph, published_version = version, published_at = now() where id = '5b7f1d2e-0c11-4a55-9a3c-1f0e6d3a7b03';
```
15. **Aprovação da implementação (dono, 2026-10-12): "sim pode implementar tudo"** → Fase 1 (configurar Fluxos) e Fase 2 (5 itens de código) do `DOSSIE.md`; transferência do silêncio **só daqui para frente** (data de corte = publicação). Fase 3 continua dependendo de decisões. Anúncio (H1–H5) é executado pelo dono no Gerenciador (os agentes não alteram a Meta).
