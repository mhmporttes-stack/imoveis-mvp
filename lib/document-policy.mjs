// REGRA OFICIAL (dono, 2026-10-02): comprovante de residência é exigido SÓ do
// proponente principal (papel "titular"). Cônjuge, segundo proponente
// ("outro") e dependentes nunca geram pendência de comprovante de residência,
// qualquer que seja o tipo de renda (CLT ou informal). Fonte única da regra —
// usada pela validação pós-análise (lib/document-analysis.js), pelo
// recálculo/reanálise (lib/client-documents.js) e por residenceDecision.
export const RESIDENCE_NOT_REQUIRED_NOTE = "Comprovante de residência é exigido apenas do proponente principal; não gera pendência para o segundo proponente.";
const RESIDENCE_PROBLEM_STATUSES = new Set(["pendencia", "precisa_confirmacao", "ilegivel", "divergencia"]);

export function isResidenceRequiredForRole(personRole) {
  return personRole === "titular";
}

// Item de comprovante de residência de quem NÃO é o principal: qualquer
// pendência/validação sobre ele é descartada (vira "conforme" com nota). O
// status original fica em extractedData.residenceNotRequiredFrom para o motor
// não contar como prova de residência do principal o que antes nem era
// considerado válido (precisa_confirmacao). Idempotente; não mexe em outros
// tipos de documento nem em itens do principal.
export function normalizeNonPrincipalResidenceItem(item) {
  if (!item || item.documentType !== "comprovante_residencia" || isResidenceRequiredForRole(item.personRole)) return item;
  if (!RESIDENCE_PROBLEM_STATUSES.has(item.status)) return item;
  return {
    ...item,
    status: "conforme",
    observations: RESIDENCE_NOT_REQUIRED_NOTE,
    ruleTrace: null,
    extractedData: { ...(item.extractedData || {}), residenceNotRequiredFrom: item.status }
  };
}

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
    if (!["pendencia", "ausente", "ilegivel", "precisa_confirmacao"].includes(item.status)) continue;
    // Divergências e validações internas não são tarefas do cliente.
    if (item.status === "precisa_confirmacao" && !/envie|reenvi|informe|esclare|ileg[ií]vel|desatualizad|vencid/i.test(item.observations || "")) continue;
    const key = `${item.personRole || "titular"}:${item.documentType}`;
    const observation = item.observations || "";
    const reason = item.status === "ausente" ? "Documento pendente." : item.status === "ilegivel" || /ileg[ií]vel/i.test(observation) ? "Documento ilegível." : /desatualizad|vencid/i.test(observation) ? "Documento desatualizado." : /incomplet|p[aá]gina faltando/i.test(observation) ? "Documento incompleto." : /envie|reenvi/i.test(observation) ? "Documento pendente." : "Favor esclarecer esta informação.";
    if (!unique.has(key)) unique.set(key, { label: item.documentTypeLabel || item.documentType, reason });
  }
  if (!unique.size) return "";
  return `*DEVOLUTIVA CAIXA DOCUMENTAÇÃO*\n\n${[...unique.values()].map(({ label, reason }) => `• ${label}\n_${reason}_`).join("\n\n")}`;
}

export function visibleDocumentDivergences(divergences) {
  const seen = new Set();
  const result = [];
  for (const entry of divergences || []) {
    const raw = String(entry.description || "");
    const plain = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Uma certidão averbada não é divergência só por registrar casamento anterior.
    if (/averba(c|ç)[aã]o.*div[oó]rcio|div[oó]rcio.*averba(c|ç)[aã]o/i.test(raw) && !/sem averba|aus[eê]ncia de averba/i.test(raw)) continue;
    let key, description;
    if (/duplicad|mesmo documento|id[eê]ntic|mesmo per[ií]odo/.test(plain) && /extrat/.test(plain)) {
      const ids = [...plain.matchAll(/#\s*(\d+)/g)].map((match) => match[1]).sort();
      key = `extrato-duplicado:${ids.join(":")}`;
      description = "Os extratos enviados parecem corresponder ao mesmo período. Confira os arquivos.";
    } else if (/ctps|rais|v[ií]nculo profissional/.test(plain)) {
      key = "vinculo-profissional"; description = "CTPS e cadastro apresentam informações diferentes sobre o vínculo profissional. Confira os dados.";
    } else if (/estado civil|certid[aã]o de casamento/.test(plain)) {
      key = "estado-civil"; description = "Estado civil do cadastro diverge da certidão apresentada. Confira os dados.";
    } else if (/valor|lan[cç]amento/.test(plain) && /extrat/.test(plain)) {
      key = "valores-extrato"; description = "Não foi possível confirmar os valores do extrato. Confira o documento.";
    } else {
      description = raw.replace(/['"`][\w-]+['"`]/g, "dados internos").replace(/\b[a-z]+(?:_[a-z]+)+\b/gi, "dados internos").split(/[.;]\s/)[0].slice(0, 150).trim();
      key = plain.replace(/\W+/g, " ").trim();
      if (!description) continue;
      if (!/[.!?]$/.test(description)) description += ".";
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, description });
  }
  return result;
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
