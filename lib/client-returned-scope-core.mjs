// Cliente DEVOLVIDO À FILA depois de um disparo (2026-10-05): a Prospecção tira o
// responsável (responsible_user_id = null, regra P-05), mas quem disparou
// precisa ENCONTRAR o cliente — pesquisando por nome/telefone — para tratar a
// resposta (ex.: "número errado" -> Não contactar). O banco guarda quem era o
// responsável na devolução em simulation_registrations.returned_from_user_id
// (gatilho client_returned_from_user, migration 20261005190000). Esta cláusula
// é a ÚNICA definição do acesso extra: só enquanto o cliente está sem
// responsável e só para quem era o responsável (ou o corretor a quem o
// associado está vinculado). Puro e testado (tests/client-returned-scope.test.mjs).

export function brokerClientScopeClause(ids, column = "responsible_user_id", returnedColumn = "returned_from_user_id") {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return "";
  const inList = list.join(",");
  return `${column}.in.(${inList}),and(${column}.is.null,${returnedColumn}.in.(${inList}))`;
}

// Id que decide o acesso a UM cliente: o responsável; sem responsável, quem
// era o responsável quando ele foi devolvido à fila.
export function clientAccessOwnerId({ responsibleUserId = "", returnedFromUserId = "" } = {}) {
  return responsibleUserId || returnedFromUserId || "";
}
