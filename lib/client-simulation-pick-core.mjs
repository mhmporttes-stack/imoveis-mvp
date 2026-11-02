// Qual simulação representa o cliente quando ele tem mais de uma. Fonte única: lista de Clientes (lib/simulation-list-query.js)
// e botão "Enviar simulação pelo meu WhatsApp" do Chat (lib/whatsapp-chat.js). Puro e testado.

export function pickBestSimulationRow(rows = []) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];

  // Um cadastro raramente tem mais de uma simulação, mas quando tem
  // (re-simulação), preferimos a mais completa (com valores preenchidos) e,
  // empatado, a mais recente — mesmo critério informal que o merge antigo no
  // navegador usava (getClientScore), só que aplicado a um punhado de linhas
  // por cliente, nunca à base inteira.
  return rows.slice().sort((a, b) => {
    const scoreA = (Number(a.financing_value || 0) > 0 || Number(a.subsidy_value || 0) > 0) ? 1 : 0;
    const scoreB = (Number(b.financing_value || 0) > 0 || Number(b.subsidy_value || 0) > 0) ? 1 : 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  })[0];
}
