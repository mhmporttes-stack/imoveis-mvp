// Estado da rodada que vai ao CRM junto do sinal (1.9.8). Lógica pura, testada em tests/round-status.test.js.
//
// Problema real (24–25/10/2026): o sinal da extensão (MKT-2g) só saía na chamada de sincronização feita DEPOIS de ler a
// caixa do Facebook. Quando a leitura falhava (página oculta com a janela de trabalho atrás de outra em tela cheia,
// prazo estourado, aba fechada), a rodada terminava em erro sem chamar o CRM: nenhum sinal, nenhum motivo e nenhuma
// resposta dos corretores enviada (o envio vinha depois da leitura) — "silêncio total" desde 24/10 12:44 UTC.
// Agora toda rodada que roda (e a pausa) chama o CRM com { ok, stage, error }: o CRM grava o sinal, guarda o motivo e só
// conta como "leitura" a rodada ok.

export const ROUND_ERROR_MAX = 300;

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, ROUND_ERROR_MAX);

// skipReason: rodada não rodou por pausa (pausado / pausa_verificacao) — o CRM vê o motivo em vez de silêncio.
// fatalError: a rodada parou no meio (aba de trabalho, trava, erro inesperado).
// inboxError: a caixa do Marketplace não foi lida (as respostas ainda são tentadas).
// hidden: a página ficou oculta para o Chrome mesmo com a emulação de foco (depurador recusado, janela minimizada).
export function roundStatus({ skipReason = "", skipDetail = "", fatalError = "", inboxError = "", hidden = "", result = "", note = "" } = {}) {
  if (skipReason) return { ok: false, stage: clean(skipReason).slice(0, 40), error: clean(skipDetail || skipReason) };
  if (fatalError) return { ok: false, stage: "rodada", error: clean(fatalError) };
  if (inboxError) return { ok: false, stage: "caixa", error: clean(inboxError) };
  if (hidden) return { ok: false, stage: "aba_oculta", error: clean(hidden) };
  return { ok: true, stage: clean(result || "chat_sincronizado").slice(0, 40), error: clean(note) };
}

// Rodadas puladas que avisam o CRM (as demais — fora do horário, desligada, outra rodada/publicação em andamento — não
// precisam: a rodada viva ou o horário explicam).
// 1.10.0: "parado_crm" (Extensões › Parar tudo) também avisa — o monitor MKT-2g vê o motivo em vez de "sem sinal".
export const SIGNALED_SKIPS = new Set(["pausado", "pausa_verificacao", "parado_crm"]);
