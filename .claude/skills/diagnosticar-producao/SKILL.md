---
name: diagnosticar-producao
description: Investiga um problema que acontece em produção no CRM imoveis-mvp (erro no site/painel, cron, webhook, WhatsApp, automação) esgotando primeiro logs e consultas somente leitura, antes de publicar qualquer código de diagnóstico. Use quando o comportamento errado só aparece em produção, ou antes de pensar em "subir um log temporário".
---

# Diagnosticar um problema em produção

Neste projeto **`git push` para `main` = deploy em produção**. Código de diagnóstico publicado custa um deploy para pôr e outro para tirar, e pode expor dado. Em 30/09/2026 foram três commits de "Diagnóstico temporário" seguidos para achar um único erro de cadastro. Siga a ordem abaixo e só avance quando a etapa anterior não bastar.

## 0. Regras fixas

- Nunca envie mensagem, e-mail ou push real, nem grave dado em produção, "para testar".
- Consultas ao banco de produção só com **SELECT**.
- Não imprima nem cole segredos, tokens ou dados pessoais completos (CPF, telefone) na resposta.

## 1. Fixar um caso concreto

Monte um caso concreto: quem (usuário/perfil), qual cliente (id), quando (horário de São Paulo), qual tela/rota/cron e a mensagem de erro exata. Sem isso, peça ao dono antes de investigar às cegas.

## 2. Fontes de leitura (nesta ordem)

1. **MCP do Supabase**, se estiver disponível na sessão (projeto `tshhasbbchjcvhoyizoo`):
   - `query_logs`: logs de API/PostgREST, Postgres e Auth, no horário do caso. Erros `PGRST*`, timeouts, violação de constraint.
   - `execute_sql` com SELECT no estado real do registro envolvido e nas tabelas de log do próprio sistema: `cron.job_run_details` (crons), `whatsapp_master_events` (webhook oficial), `crm_automation_executions`, `daily_goal_auto_queue` (status/erro da automação), `lead_distribution_history`, `ai_usage_log`, `client_status_history`.
   - `get_advisors` quando a suspeita for lentidão ou segurança.
2. **Logs da Vercel**: painel do projeto `imoveis-mvp` ou `vercel logs`, que só funciona onde houver login da Vercel (normalmente a máquina do dono). Em sessão web, peça ao dono o trecho do log se precisar.
3. **Código**: refaça mentalmente o caminho do caso pelo código atual (rota → `lib/` → banco). Confira o tratamento de erro: muitas rotas devolvem mensagem genérica e escondem a causa real.
4. **Reprodução fora de produção**: chame a função pura (`*.mjs` testável) com os dados do caso num teste `node --test` ou num script em `scratch/` (apagado ao final).

## 3. Só então: código de diagnóstico temporário

Use só se as etapas acima não identificarem a causa, e avise o dono antes de publicar:

- Junte **toda** a instrumentação num único commit, prefixado "Diagnóstico temporário:". Nada de um push por hipótese.
- Prefira `console.error` com contexto (visível nos logs da Vercel) a devolver detalhe na resposta HTTP. Se precisar devolver, só em rota protegida por guard de admin, nunca em formulário público.
- Rota temporária: nome sem `_` inicial (o App Router ignora), com guard de `lib/admin-auth.js`, sem dados pessoais nem segredos na resposta.
- Remova na mesma tarefa, no commit da correção ou logo depois, e confirme que a remoção foi ao ar.

## 4. Depois de achar a causa

Siga a correção pela skill `/corrigir-bug` (causa raiz). Valide com o **mesmo caso** do passo 1 e registre em `docs/CHANGELOG_AI.md`: causa, correção e diagnóstico removido.
