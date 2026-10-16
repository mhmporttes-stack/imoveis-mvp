# Dossiê final: WhatsApp dos corretores (16/10/2026)

Mesa enxuta: Dados, WhatsApp/automação e Viabilidade, em 3 rodadas (arquivos R1-*, R2-*, R3-*). Versão final: V9 (R3-3-viabilidade.md). Nada foi publicado; cada item marcado "SIM" depende do dono.

## Diagnóstico
- A prospecção automática quase parou em 14 e 15/10 porque a espera de 2 h recomeçava a cada reconexão automática. Já foi corrigido (140f9be9); a checagem é às 15h de 16/10.
- 58 % das quedas 500 acontecem aos ~50 min de conexão. Hipótese: o Baileys 6.7.24 não confirma ao WhatsApp a mensagem recebida que não decifra. Hipótese concorrente: confirmação sem o campo `from`. O diagnóstico passivo separa as duas.
- 401 com "conflict" = aparelho removido pelo WhatsApp ou pelo celular, não sessão duplicada.
- Recibo "antes do envio" é corrida de gravação. 48 % das mensagens automáticas de 14 dias ficaram sem recibo.
- Os cadastros próprios para reativar são 341 (não ~3.500), dos quais 160 entraram por conta própria. A base importada continua sendo o volume principal; pelos Termos do WhatsApp nenhum envio frio por cliente não oficial é "seguro".
- O formulário de simulação não avisa sobre contato pelo WhatsApp.
- Defeito: o CSV do Disparo Oficial não bloqueia "Não contactar" do cadastro do CRM.

## As 5 respostas (V9)
1. Prospectar: 15 por dia pelo Número de prospecção, janela oficial 06:30–18:00, base importada com textos neutros. Reativação dos 341 arquivada.
2. Detectar cedo: diagnóstico passivo, recibos pelo `send_started_at`, 401 pelo tipo, marca "em risco", alarme só depois de calibrado.
3. Voltar rápido: tabela da V5 (R2-2). 401 "aparelho removido" logo depois de um envio = QR só no dia seguinte. Gestora resolve as pausas.
4. Reserva: sem rodízio; Número 2 para relacionamento; chip reserva só se o dono pagar.
5. Salvar/responder: 1ª mensagem sem link e com pergunta; link só depois da resposta, junto com o pedido para salvar o contato; *SAIR* continua.

## Plano
Tabela completa no R3-3-viabilidade.md §(d). Passos 0 (checagem) e 3 (correção de defeitos) não dependem do dono; todos os outros dependem.

## Decisões do dono
Ver a mensagem de apresentação. Registrar as respostas em DECISOES-DONO.md.
