# Brief — Mesa: WhatsApp dos corretores sem queimar números (2026-10-16)

Texto do dono (15/10/2026), resumido:
- **Como conecta:** cada corretor conecta até 2 números pessoais por QR Code (ferramenta NÃO oficial — Baileys, microsserviço `whatsapp-individual-service/` no Railway). Por eles saem o Chat do corretor, a prospecção automática da Meta Diária e o "Disparar".
- **Regras de envio (prospecção):** máx. 15 mensagens/dia por corretor, 5–10 min entre elas, horário aleatório, só dia útil, 6h–18h30; 3 tentativas por contato da base fria, textos variados; só com número conectado e "Usar para disparo" ligado.
- **Proteções existentes:** 403 → pausa, volta manual, máx. 3 reconexões/h; logout → pausa manual; > 6 quedas em 3 h → para de reconectar; enviadas sem entrega (ex.: 15/0) → pausa por suspeita de restrição; conexão falsa → cinza; 4 h sem enviar nem receber → laranja e sai da roleta; alerta no celular quando cai.
- **Estados:** Conectado (tudo); Desconectado (perde Chat e prospecção, vai para lista impressa da gestão); Restrição informada (sem benefício até validar); Restrição validada (admin/gestora: Meta Diária manual, devolve tempo, sem penalidade); Roleta só para conectado + ativo + presente.
- **Dor:** quedas e restrições frequentes (12–13/10: Bencke 403; Caroline logout; Ketlin logout nos 2 números; Bruna 15 enviadas/0 entregues e depois logout). Cada queda tira o corretor da prospecção e da roleta, meta em 0 % até alguém perceber. O CRM não distingue com segurança restrição × ban × queda comum. Ferramenta não oficial = risco de ban e mudanças sem aviso. Cliente que não salvou o número e ainda não conversou não consegue tocar nos links (simulação/apresentação).

**Perguntas da rodada:**
1. Como prospectar a base fria sem queimar os números (volume, aquecimento, conteúdo, horário)?
2. Como detectar restrição cedo, antes de perder o dia, só com sinais que o CRM já tem (entregue, lido, respondido)?
3. Que rotina faz o corretor voltar a produzir rápido quando o número cai?
4. Vale número reserva por corretor, ou rodízio entre os 2 números?
5. Como fazer o cliente salvar o número ou responder logo no 1º contato, para os links funcionarem?

**Mesa (enxuta, pedido do dono de usar só o necessário):** Dados do CRM → WhatsApp e automação (com a lente de atendimento humanizado para a pergunta 5) → Viabilidade no CRM. 3 rodadas. Nada é implementado sem "sim" do dono. Restrições: regra 9 do CLAUDE.md (do_not_contact, sem envio real como teste), rules `integracoes-externas.md`, `meta-diaria-ranking.md`, `roleta-prospeccao-campanhas.md`, WA-* em `docs/BUSINESS_RULES.md`, `docs/WHATSAPP.md` §1-A..1-E.
