# Rodada 2: cadeira Dados do CRM (Versão 4)

**Resumo.** Na prática a automação está parada há 2 dias: 14/10 teve 7 envios e 15/10 teve 2, contra 45 a 52 por dia de 10 a 13/10. A causa mais provável é a espera de 2 h depois de (re)conectar (regra de 13/10) somada às reconexões automáticas, que acontecem a cada ~50 min. A "base com consentimento" da V3 praticamente não existe: 12 de 33.027 contatos. Os 401 se concentram logo depois de conectar, o que fortalece a hipótese de IP/identificação. Celular parado não explica nenhuma queda.

Fonte: Supabase (somente leitura), horário de São Paulo. A telemetria começa em 04/10, envios automáticos vão de 29/09 a 15/10 (n = 608), o retrato da fila e das sessões é de 16/10 00:54. São os mesmos **36 episódios** da V1, conferidos.

## (a) Resposta às objeções contra a V1
- **S2 (teto 5 em 7 dias):** aceito. 8 dos 25 casos de "reincidência" eram só o corretor tentando parear de novo, ou seja, artefato. S2 fica como **marca de "em risco" no painel**, sem regra de envio paralela ao aquecimento.
- **"Descartável":** aceito. O nome passa a ser "Número de prospecção, sem cliente em andamento".
- **9h–14h:** aceito como teste e não como regra. Hoje nem dá para testar, porque quase nada sai.
- **"Entregue 58 %" = 1 tique:** aceito, e os dados mostram que os 42 % não são só recibo perdido. Mensagem sem recibo teve resposta em 4,3 % dos casos (11/256, IC 2,4–7,5); com recibo, 12,2 % (43/352, IC 9,2–16,0). Os intervalos não se sobrepõem: a maioria das sem recibo provavelmente não chegou. Mesmo assim, ≥ 11 chegaram.

## (b) Medições
1. **401/403 por `detail`:** desde 14/10 só existem 3 eventos (dois 401 sem `detail` em 14/10 e um `device_removed` em 15/10). É pouco demais para concluir. Por isso classifiquei os 36 episódios pelo tipo de ciclo e por `connected_ms`:

| Tipo | n | Corretores |
|---|---|---|
| Pareamento que falhou (QR, sessão nunca abriu) | 12 | 7 de 7 |
| Aparelho removido com a sessão aberta | 14 | 5 |
| Sessão salva recusada ao voltar | 4 | 3 |
| 403 | 6 | Bencke 3, Eduardo 3 |

2. **Logo após conectar:** 12 dos 36 são pareamento, que por definição acontece na conexão. Dos 14 "removidos com a sessão aberta", **8 caíram ≤ 30 min depois de abrir** (57 %, IC 33–79). Nas quedas comuns 500/428/503 isso acontece em 12 % (87/715, IC 10–15). O WhatsApp derruba o aparelho logo após (re)conectar muito mais do que o acaso explicaria. Isso apoia a hipótese de IP de datacenter ou identificação do navegador, mas não prova causa. Reinício do serviço até 60 min antes só aparece em 7/36, então não é a explicação principal.
3. **Recibos:** atraso mediano de 35 s, 90 % chegam em até 33 min, 53 demoram mais de 15 min. 42 % (256/608) nunca têm recibo. Em **28 casos o recibo é anterior ao `sent_at`**, o que mostra que a corrida existe (o recibo chega antes de o envio ser registrado). Isso apoia o defeito D1 da V3.
4. **Fila:**
   - 06–09/10: 0 envios. Quase nada foi enfileirado (50 cancelados por reconciliação). Os 101 erros do Google Contacts em 09–10/10 são de **um único corretor**, então não explicam o zero geral. A pausa "teste lento" de 05/10 é uma hipótese a confirmar com o dono.
   - Depois de 10/10 a fila parou de novo: 14/10 = 7 e 15/10 = 2. Os números ficaram conectados, mas reconectam com mediana de 50 min entre conexões na janela de envio. A espera de 2 h recomeça a cada reconexão (`last_connected_at` é atualizado também em 428/500). Hipótese forte, **a confirmar no `/diagnosticar-producao`** com o `crm-editor`.
   - Retrato de hoje: 2 corretores com 12 pendentes desde 10/10, que é retenção esperada (pausa ou "Usar para disparo" desligado). 4 dos 8 estão pausados aguardando retomada manual, há 1 a 11 dias.
   - Até 13/10 o envio era compacto: intervalo mediano de 6–8 min, 15 envios em ~2 h de manhã.
5. **Cadastro prévio:** os 498 contatos que receberam envio são **todos importados** (base criada de 01 a 14/09). O `registration_id` deles foi criado pela própria prospecção (origem "manual"), então **não indica consentimento**. Na base inteira, só **12 de 33.027 (0,04 %)** têm cadastro anterior pelo telefone. Não há grupo para comparar a resposta útil.
6. **Apresentação:** nenhum contato da prospecção recebeu apresentação (0/498). No geral, das 73 apresentações desde 05/10, abriram 50/58 entre quem não conversou antes e 13/15 entre quem conversou, mediana de 1 a 3 min até abrir. n é pequeno e a abertura pode incluir a prévia do corretor. Não dá para medir o efeito de "responder antes".
7. **Celular parado:** 0 de 36 episódios. Em 33/36 havia mensagem naquele número nas 24 h anteriores. Ressalva: não dá para separar mensagem do celular de mensagem do CRM.

## (c) Questionamentos à V3
1. **"Base primeiro de quem deixou o número"** usando `registration_id` daria um filtro enganoso (100 % dos já contatados "têm cadastro") e um universo real de 12 contatos. A decisão de fundo é do dono: prospectar base importada sem consentimento, ou trocar por reativação dos próprios cadastros (~3.500).
2. **A1 "3 seguidas sem tique em 15 min":** hoje 51 % das mensagens ficam sem tique em 15 min. Pausaria quase todo dia por falso alarme. Só calibrar depois do D1.
3. Falta na V3 o **bloqueio atual**: a espera de 2 h × reconexões. Proteger o número não adianta se nada sai.

## VERSÃO 4
1. **Prospectar:** 15 por corretor/dia pelo Número de prospecção. **Antes de qualquer volume, destravar a fila:** a espera de 2 h passa a contar só depois de QR novo, 401 ou 403, e não depois de queda comum 428/500/503. Decisão do dono, porque a regra de 13/10 diz "todo (re)conectar". Só 1ª e 2ª automáticas. Janela 8h–18h. Sábado com teto 5. Base: decisão do dono entre importados (risco pelos Termos) e reativação de cadastros próprios.
2. **Detectar cedo:**
   - D1 (recibos) primeiro.
   - Painel mostra 401 em 3 tipos: pareamento falho → suporte; removido com sessão aberta → alerta de risco de IP; recusado ao voltar.
   - Marca "em risco" para número com queda grave nos últimos 7 dias, sem contar pareamento. Na V1 cobria 17 de 24 quedas reais.
   - A1 só depois de calibrar com os recibos novos.
3. **Voltar rápido:** rotina da V2. Pausas por número com prazo: gestora retoma ou nega em ≤ 1 dia útil (hoje 4 de 8 parados há 1 a 11 dias).
4. **Reserva:** igual à V3.
5. **Salvar/responder:** igual à V3. A medição por `first_opened_at` só faz sentido quando a prospecção gerar apresentações (hoje 0).

**Fases**
- **F1 (sem código):** dono decide a espera de 2 h, a base e a 3ª tentativa; gestora revisa as 4 pausas; conferir "Usar para disparo".
- **F2:** `/diagnosticar-producao` da fila de 14–15/10; D1 recibos; 401 por tipo no painel; marca "em risco".
- **F3:** teste de IP residencial em número de teste (medir "401 ≤ 30 min após abrir": base de 8/14); A1 calibrado; janela/sábado.

**Painel de indicadores**

| Indicador | Hoje | Meta |
|---|---|---|
| Envios automáticos/dia (equipe) | 45–52 (10–13/10); 2–7 (14–15/10) | ≥ 80 % de 15 × corretores aptos |
| Corretores pausados há > 1 dia útil | 4/8 | 0 |
| % sem tique em 24 h | 42 % (256/608) | < 15 % depois do D1 |
| Resposta útil na 1ª tentativa | 9,2 % (26/283) | manter ≥ 9 % |
| 401 ≤ 30 min após abrir | 8/14 | queda no teste de IP |
| Horas sem número na janela (mediana) | ~15 h | < 2 h |

**O que mudei e por quê**
1. Destravar a fila virou prioridade 1, porque 14–15/10 tiveram ≈ 0 envios.
2. Base com consentimento virou decisão do dono, porque o universo é de 12 contatos.
3. A1 adiado, porque 51 % ficam sem tique em 15 min.
4. 401 dividido em 3 tipos, com ação diferente para cada.
5. S2 virou marca no painel, sem regra (8 dos 25 casos eram pareamento).
6. Entrou prazo para retomar pausas.
7. Hipótese de celular parado descartada (0/36).
8. Teste de IP ganhou métrica de base (8/14).

**Para a próxima cadeira (WhatsApp e automação)**
- O 500 `bad_session` nunca acontece antes de 30 min de conexão (mediana 50 min). Parece mecânico, como renovação de sessão ou proxy: vale investigar.
- Desenhar o teste de IP/identificação usando o indicador "401 ≤ 30 min após abrir".
- Confirmar no código que reconexão 428/500 atualiza `last_connected_at` e reinicia a espera.
- Gravar a origem da conexão (QR × automática) para medir isso sem inferência.

**Limitações:** quase não há `detail` (n = 3). Respostas por LID podem estar subcontadas. Houve várias mudanças de regra entre 02 e 13/10. Não salvei memória porque não tenho ferramenta de escrita nesta sessão.

Consultas, todas SELECT:
- episódios 401/403 com intervalo > 6 h × gatilho do ciclo × `connected_ms`;
- quedas comuns ≤ 30 min;
- `sent_at` → `delivered_at` e resposta em 7 dias;
- fila por dia, status e motivo, mais o estado atual de `daily_goal_auto_settings`/sessões;
- intervalo entre conexões;
- cadastro anterior pelo telefone;
- `simulation_presentations` × conversa prévia;
- última mensagem do número antes da queda.
