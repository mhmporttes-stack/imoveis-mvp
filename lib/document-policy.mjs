const VALID_RESIDENCE = new Set(["water", "electricity", "internet", "telephone"]);
export function residenceSourceDecision(source, { cardAsIncome = false, hasRegularProof = false, enabled = true } = {}) {
  if (!enabled) return null;
  if (/boleto/i.test(String(source || ""))) return "rejected";
  if (VALID_RESIDENCE.has(source)) return "accepted";
  if (source === "credit_card" && cardAsIncome && !hasRegularProof) return "accepted";
  if (["bank_statement", "generic_bill", "credit_card"].includes(source)) return "rejected";
  return "validation";
}

const EXCLUDED = new Set(["self", "spouse", "first_degree_relative"]);
export function calculateBankIncome(months) {
  return calculateBankIncomeForClient(months, {});
}
export function calculateBankIncomeForClient(months, { clientName = "", spouseNames = [], relativeNames = [] } = {}) {
  const normalize = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
  const verifiedNames = { self: [clientName], spouse: spouseNames, first_degree_relative: relativeNames };
  const byMonth = new Map();
  for (const month of months || []) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month?.month || "")) continue;
    const credits = byMonth.get(month.month) || [];
    for (const entry of month.credits || []) {
      const amount = Math.round(Number(entry.amount) * 100);
      if (!Number.isSafeInteger(amount) || amount <= 0) continue;
      const payer = normalize(entry.payerName);
      const relation = EXCLUDED.has(entry.relation) && entry.evidence && payer.length >= 5 && verifiedNames[entry.relation]?.some((name) => normalize(name) === payer) ? entry.relation : null;
      credits.push({ amount, relation, evidence: relation ? String(entry.evidence).slice(0, 180) : "" });
    }
    byMonth.set(month.month, credits);
  }
  const rows = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).slice(-3).map(([month, credits]) => {
    const grossCents = credits.reduce((sum, credit) => sum + credit.amount, 0);
    const excludedCents = credits.filter((credit) => credit.relation).reduce((sum, credit) => sum + credit.amount, 0);
    return { month, gross: grossCents / 100, excluded: excludedCents / 100, net: (grossCents - excludedCents) / 100, exclusions: credits.filter((credit) => credit.relation).map((credit) => ({ amount: credit.amount / 100, relation: credit.relation, evidence: credit.evidence })) };
  });
  if (rows.length !== 3) return { needsValidation: true, months: rows };
  const gross = rows.reduce((sum, row) => sum + Math.round(row.gross * 100), 0);
  const net = rows.reduce((sum, row) => sum + Math.round(row.net * 100), 0);
  return { needsValidation: false, months: rows, grossTotal: gross / 100, netTotal: net / 100, grossMonthlyAverage: Math.round(gross / 3) / 100, netMonthlyAverage: Math.round(net / 3) / 100 };
}

export function pendingClientMessage(items) {
  const unique = new Map();
  for (const item of items || []) {
    if (!["pendencia", "ausente", "ilegivel", "divergencia", "precisa_confirmacao"].includes(item.status)) continue;
    const key = `${item.personRole || "titular"}:${item.documentType}`;
    if (!unique.has(key)) unique.set(key, { label: item.documentTypeLabel || item.documentType, reason: item.status === "ausente" ? "Favor enviar este documento." : item.status === "ilegivel" ? "Favor enviar uma nova foto legível e completa." : /desatualizad|vencid/i.test(item.observations || "") ? "Favor enviar uma versão atualizada." : item.status === "divergencia" ? "Favor conferir os dados informados." : "Favor conferir e reenviar para validação." });
  }
  if (!unique.size) return "";
  return `*ANÁLISE DE DOCUMENTOS*\n\n${[...unique.values()].map(({ label, reason }) => `• ${label}\n_${reason.replace(/[\*_]/g, "").slice(0, 180)}_`).join("\n\n")}`;
}

export function partitionChatSelection(messages, ids) {
  const selected = new Set(ids);
  const rows = (messages || []).filter((row) => selected.has(row.id) && row.direction !== "internal");
  return {
    texts: rows.filter((row) => ["text", "button", "interactive"].includes(row.message_type) && row.body?.trim()).map((row) => ({ id: row.id, body: row.body.slice(0, 2000) })),
    media: rows.filter((row) => ["image", "document"].includes(row.message_type))
  };
}

export function extractSelectedContactFacts(messages) {
  const text = (messages || []).map((entry) => entry.body).join("\n");
  return { email: text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || "", pis: String(text.match(/\b\d{3}[. ]?\d{5}[. ]?\d{2}[- ]?\d\b/)?.[0] || "").replace(/\D/g, "").slice(0, 11) };
}
