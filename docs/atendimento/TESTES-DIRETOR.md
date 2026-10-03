# Testes do Diretor de Atendimento (Fase 5, 2026-10-03)

Seis missões fictícias. Nada foi enviado a cliente, nada foi escrito em banco ou produção. Objetivo: provar que o Diretor monta **equipe mínima** (nunca as 17) e que o Auditor acha defeitos reais.

Limite observado: a plataforma permite 20 subagentes simultâneos. Rodar os 6 Diretores juntos estourou o limite, e o Diretor, como manda o protocolo, **não repetiu** a chamada recusada: devolveu o cabeçalho pronto. A Central rodou depois os pareceres que faltavam, poucos por vez. Nota: o Diretor, ao ser chamado como subagente, consegue chamar os executores (aninhamento funciona).

| # | Missão | Especialistas selecionados (de 17) | Por quê | Não chamados |
|---|---|---|---|---|
| 1 | Lead patrocinado que sumiu | 7: followup-vacuo, vendas-conversao, comportamento-lead, copy-comercial, whatsapp-oficial-meta, compliance-lgpd, auditor-automacoes | Cadência + texto + regra Meta + base de contato + auditoria antes de automatizar | 10 (simulação, reativação, qualidade, dados, A/B, documentação, etc.) |
| 2 | Simulação feita e parou de responder | 5 | Simulação, vácuo, vendas, copy, WhatsApp | demais |
| 3 | Aprovado, não marcou reunião | 3–4 | Vendas, jornada, copy, documentação | demais |
| 4 | 60 dias sem responder | 4–6 | Reativação 30/60/90, vendas, copy, LGPD, WhatsApp Oficial | demais |
| 5 | Corretor com atendimento ruim, analisado pelo Guia | 5 | Atendimento imobiliário (Guia), qualidade, vendas, português, primeiro imóvel | demais |
| 6 | Automação complexa a auditar | 2 (Auditor independente + LGPD) | Auditoria é o foco; só quem é necessário | 15 |

## Conclusões consolidadas

1. **Patrocinado que sumiu:** automação **não aprovável como está**. Auditor: falta reconferir "Não contactar" no momento do envio (a trava só vale ao avaliar o gatilho) e falta parada quando o cliente responde. Seis condições para aprovar (saída por Não contactar/resposta, idempotência e teto por cliente, templates aprovados, opt-in comprovado, janela de horário, log por envio). LGPD: registrar opt-in (data, origem, texto, finalidade), opt-out em cada mensagem, base legal a validar com advogado. Meta (cenário 4): fora da janela de 24h só template aprovado; limite é por portfólio, não por número. Enquanto isso, fluxo manual com lembrete ao corretor.
2. **Simulação parada / 3. Aprovado sem reunião:** equipe mínima respondeu com abordagem sem prometer renda, parcela, entrada, aprovação nem urgência falsa; valores só do motor `lib/simulacao-entrada`.
4. **60 dias:** só contata quem tem opt-in e não está em Não contactar, com template de marketing e saída clara; aumentar volume aos poucos.
5. **Corretor ruim pelo Guia:** violações apontadas mensagem a mensagem (financiamento afirmado sem qualificar, documentos antes de investigar, objeção sem resposta por 2 dias, "ainda tem interesse?"). 7 sugestões de melhoria do Guia, **só sugestões** (Guia não alterado).
6. **Automação com defeitos plantados:** Auditor **REPROVOU** (3 P0, 4 P1, 3 P2, 2 P3). Achou todos os plantados: Não contactar ausente (A, B, C), reativação em lote sem opt-in e sem template (C), promessa de valores + urgência falsa (B), "sem interesse" automático por silêncio, sobreposição A×B×C, sem parada na resposta, janela de 24h, sem log/idempotência. LGPD concordou de forma independente.

## Evidência de que a equipe não é chamada inteira

Máximo de 7 de 17 por missão; cada Diretor listou por escrito quem **não** chamou e por quê. O cenário 6 usou 2.

## Limites do teste

Dados fictícios; motor de automações lido por trechos; dados reais e `lib/do-not-contact-core.mjs` não verificados; regras Meta lidas via ferramenta de leitura (conferir pontos críticos no WhatsApp Manager).
