// Núcleo puro (sem banco) da remoção de corretor: permissão por equipe, elegibilidade de quem
// recebe clientes e distribuição justa. Testado em tests/broker-removal-core.test.mjs.

const TEAM_MANAGED_ROLES = ["broker", "associate"];

// Gestor só remove corretor/associado da PRÓPRIA equipe (manager_id = ele). Admin geral: sem
// restrição de equipe (regra atual preservada). Qualquer outro perfil: negado.
export function canRemoveBroker({ actor, isGeneralAdmin = false, target }) {
  if (!target) return false;
  if (isGeneralAdmin) return true;
  if (actor?.role !== "manager" || !actor.id) return false;
  return TEAM_MANAGED_ROLES.includes(target.role) && target.managerId === actor.id;
}

// Quem recebe na distribuição: corretor ativo, que recebe leads (mesma flag da roleta), da mesma
// equipe do removido. Fora: o removido, inativos, gestor/admin, associados e gente de outra equipe.
export function selectEligibleRecipients(profiles, removed) {
  const removedManager = removed?.managerId || "";
  return (profiles || [])
    .filter((profile) =>
      profile.id !== removed?.id &&
      profile.role === "broker" &&
      profile.status === "active" &&
      profile.leadDistributionEnabled === true &&
      (removedManager ? profile.managerId === removedManager : true)
    )
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR") || String(a.id).localeCompare(String(b.id)));
}

// Distribui cada etapa/status separadamente e equilibra as sobras: quem tem menos clientes no
// total fica com a sobra, então ninguém acumula todas e o total por corretor difere em no máximo 1.
// Só decide o responsável; nunca altera etapa/status. Determinística (mesma entrada → mesmo plano).
export function planBalancedDistribution({ clients, recipients }) {
  const list = Array.isArray(clients) ? clients : [];
  const brokers = (Array.isArray(recipients) ? recipients : []).map((recipient) => ({ id: recipient.id, name: recipient.name || "" }));
  if (!brokers.length) throw new Error("Não há corretores elegíveis para receber os clientes.");

  const seen = new Set();
  const groups = new Map();
  for (const client of [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!client?.id || seen.has(client.id)) continue;
    seen.add(client.id);
    const status = client.status || "sem_status";
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(client.id);
  }

  const total = new Map(brokers.map((broker) => [broker.id, 0]));
  const byStatus = new Map(brokers.map((broker) => [broker.id, {}]));
  const assignments = [];

  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])));
  for (const [status, ids] of orderedGroups) {
    const base = Math.floor(ids.length / brokers.length);
    const extra = ids.length % brokers.length;
    const luckyOrder = brokers
      .map((broker, index) => ({ broker, index }))
      .sort((a, b) => total.get(a.broker.id) - total.get(b.broker.id) || a.index - b.index)
      .slice(0, extra)
      .map((item) => item.broker.id);
    const quota = new Map(brokers.map((broker) => [broker.id, base + (luckyOrder.includes(broker.id) ? 1 : 0)]));

    let cursor = 0;
    for (const broker of brokers) {
      const amount = quota.get(broker.id);
      for (let i = 0; i < amount; i += 1) assignments.push({ clientId: ids[cursor++], toId: broker.id, status });
      total.set(broker.id, total.get(broker.id) + amount);
      if (amount) byStatus.get(broker.id)[status] = (byStatus.get(broker.id)[status] || 0) + amount;
    }
  }

  return {
    assignments,
    perBroker: brokers.map((broker) => ({ id: broker.id, name: broker.name, total: total.get(broker.id), byStatus: byStatus.get(broker.id) }))
  };
}

// Transferência para um corretor só: mesmo formato de plano, para auditoria e prévia uniformes.
export function planSingleTransfer({ clients, target }) {
  return planBalancedDistribution({ clients, recipients: [target] });
}
