// Puro (sem banco, sem "server-only") — decide por QUAL canal o Chat deve
// mandar uma mensagem: a sessão pessoal (Baileys) do corretor responsável
// pela conversa, ou o número oficial (Meta Cloud API) como já funciona hoje.
//
// `individualSessionStatus`: status da linha em whatsapp_individual_sessions
// do responsável, ou null/undefined quando NÃO existe linha nenhuma (ele
// nunca configurou sessão individual).
//
// Regra (pedida pelo dono, 2026-09-28 — número oficial banido pela Meta):
//   - sem `assignedUserId` (conversa sem responsável)   -> 'cloud_api'
//   - responsável SEM sessão configurada (status null)  -> 'cloud_api'
//     (os dois casos acima preservam o caminho de hoje — não é escopo desta
//     tarefa "consertar" o número oficial banido, só não quebrar quem ainda
//     não tem sessão pessoal nenhuma)
//   - sessão do responsável com status 'connected'       -> 'individual'
//   - responsável TEM sessão configurada mas NÃO conectada (desconectada,
//     conectando, aguardando QR, reconectando, com erro...)
//                                                         -> 'blocked'
//     (nunca cai silenciosamente para o número oficial banido — melhor um
//     erro claro e a mensagem preservada do que ela nunca ser entregue)
export function pickSendChannel({ assignedUserId, individualSessionStatus } = {}) {
  if (!assignedUserId) return "cloud_api";
  if (!individualSessionStatus) return "cloud_api";
  return individualSessionStatus === "connected" ? "individual" : "blocked";
}
