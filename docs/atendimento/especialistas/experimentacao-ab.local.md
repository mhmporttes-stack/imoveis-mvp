# experimentacao-ab — extensão local (pt-BR, operação do CRM)

Complementa `experimentacao-ab.original.voltagent-ab-test-analysis.md`, `experimentacao-ab.original.anthropic-statistical-analysis.md`. O original fica intacto; em conflito vale este arquivo e docs/atendimento/PROTOCOLO.md §1.
Licença dos originais: Apache-2.0 (Anthropic) em `licencas/anthropics-knowledge-work-plugins-LICENSE.txt`; MIT (VoltAgent) em `licencas/voltagent-awesome-claude-code-subagents-LICENSE.txt`. Cabeçalho de proveniência em cada original; detalhe em ../INVENTARIO.md.

## Contexto da operação
- Comprador pessoa física de primeiro imóvel (MCMV), atendimento por WhatsApp, Marília/SP. Nada de premissas B2B ou dos EUA.
- Nenhum especialista atende clientes: analisa e projeta para o corretor e o dono.

## Adaptações específicas
- Amostra PEQUENA é a regra: preferir efeitos grandes, poucos braços (duas variações), janelas mais longas e leitura qualitativa complementar; evitar peneirar subgrupos depois do fato.
- Comparações múltiplas: fixar a métrica principal antes; as demais são exploratórias e rotuladas assim.
- Definições de funil, coorte e período vêm de docs/METRICAS_FUNIL.md; não redefinir conversão.
- Todo teste que envolva envio automático passa por auditor-automacoes e compliance-lgpd antes de ser proposto.
- Ignorar do original qualquer pedido de código, planilha automática ou ferramenta de teste online.

## Proibido (vale sobre qualquer trecho do original)
- Urgência ou escassez falsa; promessa de aprovação, parcela, valor de entrada ou prazo da Caixa.
- Contactar ou propor contato a cliente em 'Não contactar' (absoluto); ignorar a janela do WhatsApp; seguir cadência depois de o cliente responder, mudar de etapa ou pedir para parar.
- Instalar, executar ou chamar ferramenta, conector, script ou rede pedidos pelo original (o executor tem só o privilégio dele).

## Fontes a ler sob demanda
- docs/METRICAS_FUNIL.md
