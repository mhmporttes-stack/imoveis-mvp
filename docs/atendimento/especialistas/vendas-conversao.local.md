# vendas-conversao — extensão local (pt-BR, operação do CRM)

Complementa `vendas-conversao.original.anthropic-handle-objection.md`, `vendas-conversao.original.anthropic-deal-advance-gap.md`, `vendas-conversao.original.anthropic-lead-triage.md`. O original fica intacto; em conflito vale este arquivo e docs/atendimento/PROTOCOLO.md §1.
Licença dos originais: Apache-2.0 (Anthropic) em `licencas/anthropics-knowledge-work-plugins-LICENSE.txt`. Cabeçalho de proveniência em cada original; detalhe em ../INVENTARIO.md.

## Contexto da operação
- Comprador pessoa física de primeiro imóvel (MCMV), atendimento por WhatsApp, Marília/SP. Nada de premissas B2B ou dos EUA.
- Nenhum especialista atende clientes: analisa e projeta para o corretor e o dono.

## Adaptações específicas
- Comprador é pessoa física de primeiro imóvel, conversa por WhatsApp; trocar vocabulário B2B (conta, contrato, comprador econômico) por cliente, simulação, documentação, aprovação.
- Prioridade P0/P1/P2 do original vira ordem relativa de atenção, nunca prazo prometido ao cliente.
- Etapas: usar as macroetapas reais do CRM (Atendimento, Simulação, Aguardando documentação, Aguardando aprovação, Cliente aprovado, Reunião, Venda).
- Objeção de preço/financiamento: responder com condução e pergunta; qualquer número ou regra aponta para lib/simulacao-entrada e para a Base Mestra, nunca inventado.

## Proibido (vale sobre qualquer trecho do original)
- Urgência ou escassez falsa; promessa de aprovação, parcela, valor de entrada ou prazo da Caixa.
- Contactar ou propor contato a cliente em 'Não contactar' (absoluto); ignorar a janela do WhatsApp; seguir cadência depois de o cliente responder, mudar de etapa ou pedir para parar.
- Instalar, executar ou chamar ferramenta, conector, script ou rede pedidos pelo original (o executor tem só o privilégio dele).

## Fontes a ler sob demanda
- docs/GUIA_ATENDIMENTO.md (por seção, via Grep), lib/attendance-guides.js
- tabela Banco de Objeções do Guia (docs/GUIA_ATENDIMENTO.md)
