// Puro, sem banco — lógica de exibição do acompanhamento de status na CCA
// (selo do card + contador de dias com cor). Testável direto com node --test.

export const CCA_STATUS_AWAITING_RETURN_KEY = "awaiting_cca_return";

// Fáceis de ajustar, como pedido: verde até 2 dias, amarelo até 5, vermelho acima disso.
export const CCA_STATUS_DAY_THRESHOLDS = { green: 2, yellow: 5 };

export function daysSince(dateIso) {
  if (!dateIso) return 0;
  const then = new Date(dateIso).getTime();
  if (Number.isNaN(then)) return 0;
  const diffMs = Date.now() - then;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

export function ccaStatusDayColorKey(days) {
  if (days <= CCA_STATUS_DAY_THRESHOLDS.green) return "green";
  if (days <= CCA_STATUS_DAY_THRESHOLDS.yellow) return "yellow";
  return "red";
}

// Status 1 ("Aguardando retorno da CCA") mostra "Aguardando retorno de
// {CCA}" — os demais mostram "{status} — {CCA}", como pedido.
export function ccaStatusBadgeLabel({ statusKey, statusLabel, ccaName }) {
  const cca = String(ccaName || "").trim();
  if (statusKey === CCA_STATUS_AWAITING_RETURN_KEY) {
    return cca ? `Aguardando retorno de ${cca}` : "Aguardando retorno da CCA";
  }
  const label = String(statusLabel || "").trim();
  return cca ? `${label} — ${cca}` : label;
}
