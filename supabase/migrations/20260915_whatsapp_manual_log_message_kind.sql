-- WhatsApp Manual virou uma "central de comunicação" com 3 momentos da
-- jornada (Início do dia / Acompanhamento / Fechamento), cada um com vários
-- tipos de mensagem (ex.: "acompanhamento_evolucao"). summary_type continua
-- guardando só o período (today/last7/last30, usado pra montar os dados);
-- message_kind guarda qual mensagem específica foi essa, pro histórico
-- diferenciar "Início do dia — Motivação" de "Fechamento — Resumo diário"
-- em vez de mostrar só "Diário" pros dois. Sem constraint fechada (livre
-- pra extensão futura de novos tipos de mensagem sem migration nova).
alter table public.whatsapp_manual_log add column if not exists message_kind text;
