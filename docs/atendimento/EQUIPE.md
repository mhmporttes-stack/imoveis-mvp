# Equipe do Diretor de Atendimento (índice)

Uma linha por especialista. Perfil = `docs/atendimento/especialistas/<id>.md`. Executor: **restrito** = `especialista-atendimento`; **web** = `especialista-atendimento-web`. Origem: ORIGINAL + EXTENSÃO LOCAL (original externo intacto em `<id>.original.*.md` + `<id>.local.md`) · AGENTE PRÓPRIO (escrito aqui, sem original adequado). Proveniência e licenças: `INVENTARIO.md`. Estado: **montado** (perfil existe, pode ser convocado) · **a montar** (lacuna a informar ao dono). O Diretor só convoca "montado".

Preferência do dono: original + extensão local em vez de reescrever; agente próprio só onde faltou original, licença, ou o conhecimento é específico do CRM.

| id | Especialidade | Quando convocar | Perfil | Executor | Origem | Estado |
|---|---|---|---|---|---|---|
| `atendimento-imobiliario` | Atendimento imobiliário e Guia de Atendimento | Analisar atendimento pelo Guia, lacuna no Guia, roteiro | especialistas/atendimento-imobiliario.md | restrito | AGENTE PRÓPRIO | montado |
| `vendas-conversao` | Vendas e conversão (triagem, objeções, lacuna de avanço) | Atendimento que não converte, objeção, negócio parado | especialistas/vendas-conversao.md (+ .local.md + 3 originais) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `followup-vacuo` | Follow-up e vácuo (cliente que parou de responder) | Cadência, motor de vácuo, quando cobrar e quando parar | especialistas/followup-vacuo.md | restrito | AGENTE PRÓPRIO | montado |
| `copy-comercial` | Copy comercial de mensagens | Redigir/revisar mensagens e modelos | especialistas/copy-comercial.md (+ .local.md + original) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `comportamento-lead` | Comportamento do lead (quando contatar) | Estimar horário provável e estágio pelo histórico | especialistas/comportamento-lead.md | restrito | AGENTE PRÓPRIO | montado |
| `whatsapp-oficial-meta` | WhatsApp Oficial / Meta (mapa de fontes oficiais) | Qualquer regra da Meta (mutável: exige doc oficial atual) | especialistas/whatsapp-oficial-meta.md | web | AGENTE PRÓPRIO | montado |
| `primeiro-imovel-mcmv` | Primeiro imóvel e MCMV (linguagem e jornada, sem inventar regra) | Mensagem/roteiro para comprador de primeiro imóvel | especialistas/primeiro-imovel-mcmv.md | restrito | AGENTE PRÓPRIO | montado |
| `simulacao` | Simulação de financiamento no atendimento | Quando e como falar de simulação ao cliente | especialistas/simulacao.md | restrito | AGENTE PRÓPRIO | montado |
| `documentacao` | Documentação do cliente no atendimento | Cobrar documentos, pendências, abandono | especialistas/documentacao.md | restrito | AGENTE PRÓPRIO | montado |
| `reativacao-30-60-90` | Reativação 30/60/90 dias (exemplos configuráveis) | Base antiga, cliente frio, campanha de resgate | especialistas/reativacao-30-60-90.md | restrito | AGENTE PRÓPRIO | montado |
| `customer-success-jornada` | Customer success e jornada do cliente | Pós-venda, relacionamento, pontos de abandono | especialistas/customer-success-jornada.md (+ .local.md + original) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `qualidade-atendimento` | Qualidade do atendimento dos corretores | Avaliar conversas, aderência ao Guia, coaching | especialistas/qualidade-atendimento.md | restrito | AGENTE PRÓPRIO | montado |
| `portugues-comunicacao` | Português e comunicação | Revisar clareza, tom, correção de texto | especialistas/portugues-comunicacao.md | restrito | AGENTE PRÓPRIO | montado |
| `dados-conversao` | Dados e conversão (números vêm do `analista-dados`) | Desenhar métricas, ler resultado, coortes | especialistas/dados-conversao.md (+ .local.md + originais) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `experimentacao-ab` | Experimentação A/B (amostra pequena) | Testar variações com amostra e critério | especialistas/experimentacao-ab.md (+ .local.md + originais) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `auditor-automacoes` | Auditor independente de automações | **Antes de qualquer proposta** de automação/cadência | especialistas/auditor-automacoes.md (+ .local.md + originais) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `compliance-lgpd` | Conformidade LGPD operacional (não é parecer jurídico) | Contato automático, reativação, retenção, opt-out | especialistas/compliance-lgpd.md (+ .local.md + originais) | restrito | ORIGINAL + EXTENSÃO LOCAL | montado |
| `outros-descobertos` | Outros descobertos pelo Agent Scout (linha-modelo: copie e preencha) | Conforme pesquisa futura do Scout | especialistas/<id>.md | restrito ou web | a definir | a montar |

## Descobertos pelo Scout sem perfil (decisão registrada)
- `realestate-transaction-coordinator` e `realestate-buyers-agent` (hoangtng): só REFERÊNCIA para `documentacao` e `customer-success-jornada`; fluxo dos EUA, sem perfil.
- `workflow-orchestrator`, `whatsapp-cloud-api-skill`, `email-deliverability-engineer`: REFERÊNCIA de ideias (estados e guardas; qualidade de número); não vendorizados (regra mutável, tamanho ou execução de rede).
- SDRs imobiliários pt-BR (`AGENTE-SDR-IMOBILIARIO-F5`, `agenteimobi`): REFERÊNCIA; classificação quente/morno/frio fica fora da IA. Licença não verificada: não copiar.
- `qualificacao-lead` e `objecoes-negociacao` do Scout: unidos em `vendas-conversao` para não inflar a equipe.
- `Zero-Lero` e `Deslop-ptBR`: inspiração para `portugues-comunicacao`, sem copiar.
- Relatórios: `docs/scout/relatorios/2026-10-03-atendimento-*.md`.
