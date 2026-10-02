---
name: diagnosticar-bug
description: "Investiga e corrige bug do CRM, mesmo relato vago (\"travando\", \"botão parou\", com print): reproduz, acha a causa raiz, depois corrige."
---

# Diagnosticar (e corrigir) um bug

A metodologia completa — os 12 passos, o limite de 3 tentativas, abrangência, bug crítico em produção — já está em `.claude/agents/crm-editor.md` §"Diagnóstico sistemático de bugs". Use o agente `crm-editor` para a investigação e a correção em si. Esta skill cobre só o que é específico de **entrar pela porta de um bug relatado**, antes de acionar o agente, e o formato da resposta.

## Regra principal

**Nenhuma correção antes de investigar a causa raiz.** Print, relato do usuário ou mensagem de erro são evidência/sintoma, não diagnóstico.

## 1. Entender o sintoma e classificar o impacto

Se o relato for vago ("travando", "não carrega", "deu erro"), não peça detalhes técnicos ao dono (ele não é técnico) — investigue você mesmo o suficiente para formular uma hipótese testável. Se precisar de mais informação, peça algo concreto e simples ("em qual tela?", "aconteceu com qual cliente?"), nunca jargão.

## 2. Consultar se já aconteceu antes

Antes de investigar do zero, rode a skill `/consultar-incidentes` (ou `grep` em `docs/INCIDENTES.md`) com os termos do sintoma/área. Se encontrar um incidente igual ou muito parecido, comece pela causa raiz já documentada — mas confirme contra o código atual antes de reaplicar a mesma correção (o código deste projeto muda com muita frequência).

## 3. Produção ou local?

Se o problema só aparece em produção, siga `/diagnosticar-producao` para a parte de coleta de evidências (logs e consultas de leitura antes de qualquer código de diagnóstico publicado).

## 4. Investigação e correção

Delegue ao `crm-editor` com o sintoma + qualquer evidência já reunida. Ele segue os 12 passos (reproduzir → causa raiz → correção mínima → verificar), o limite de 3 tentativas falhadas, e o protocolo de bug crítico em produção quando aplicável.

## 5. Se o pedido for só investigar

Se o usuário disser algo como "só investigue" (sem autorizar correção): reporte a causa raiz encontrada e **não altere nem publique nada** até receber autorização explícita. Se autorizar a correção: investigar → corrigir → testar → build → publicar quando apropriado → validar produção.

## 6. Verificar e registrar

Depois de uma correção aplicada, siga `/verificar-correcao` antes de considerar resolvido — build verde sozinho não significa bug resolvido. Registre o incidente em `docs/INCIDENTES.md` (causa raiz + correção, curto) e, se a correção também mudou regra/arquitetura/rota/permissão, registre também em `docs/CHANGELOG_AI.md` (`AGENTS.md` §Ao terminar).

## 7. Resposta ao dono

Nada de relatório gigante para bugs comuns. Feche com:

```
Causa: ...
Correção: ...
Validação: ...
Produção: ...
Prevenção: ...
```

Detalhe mais só quando o problema exigir (causa raiz não óbvia, múltiplos pontos afetados) ou quando o dono pedir.
