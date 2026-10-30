// Escopo do Relatório diário (corretor selecionado x permissão) — regra pura, testada em
// tests/daily-report-scope.test.mjs. Uma só decisão para TODOS os blocos do relatório
// (cartões, funil, conversões, linha do tempo e tabela por corretor): nenhum bloco calcula
// escopo por conta própria.
//
// Resultado:
//   { all: true }                              admin geral sem corretor selecionado (tudo)
//   { all: false, ids, includeUnassigned }     lista de responsáveis; includeUnassigned = cliente
//                                              ainda sem corretor (fila da roleta), como o gestor
//                                              já enxerga em applyResponsibleUserScope.
// Corretor selecionado fora do escopo de quem pede => erro 403 (nunca ignorado em silêncio).

export const EMPTY_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

export class DailyReportScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DailyReportScopeError";
    this.status = 403;
  }
}

export function resolveDailyReportScope({
  isGeneralAdmin = false,
  isManager = false,
  isBroker = false,
  profileId = "",
  linkedBrokerId = "",
  managedUserIds = null,
  hasDatabaseScope = true,
  requestedBrokerIds = []
} = {}) {
  const requested = Array.from(new Set((requestedBrokerIds || []).filter(Boolean)));

  if (isGeneralAdmin) {
    return requested.length ? { all: false, ids: requested, includeUnassigned: false } : { all: true };
  }

  if (isManager && hasDatabaseScope) {
    const team = (Array.isArray(managedUserIds) && managedUserIds.length ? managedUserIds : [profileId]).filter(Boolean);
    if (requested.length) {
      if (requested.some((id) => !team.includes(id))) {
        throw new DailyReportScopeError("Corretor fora da sua equipe.");
      }
      return { all: false, ids: requested, includeUnassigned: false };
    }
    return { all: false, ids: team, includeUnassigned: true };
  }

  if (isBroker && hasDatabaseScope) {
    const own = [profileId, linkedBrokerId].filter(Boolean);
    if (requested.some((id) => !own.includes(id))) {
      throw new DailyReportScopeError("Você só pode ver os seus próprios dados.");
    }
    return { all: false, ids: requested.length ? requested : own, includeUnassigned: false };
  }

  // Perfil sem escopo utilizável (fallback/associado sem vínculo): nada é exibido.
  return { all: false, ids: [EMPTY_SCOPE_ID], includeUnassigned: false };
}

// Aplica o escopo a uma query PostgREST. `column` pode ser de tabela embutida
// ("scope.responsible_user_id"); nesse caso passe `referencedTable` ("scope") para o `or`.
export function applyDailyReportScope(query, scope, column = "responsible_user_id", referencedTable = "") {
  if (!scope || scope.all) return query;
  if (scope.includeUnassigned) {
    const bare = referencedTable ? column.slice(referencedTable.length + 1) : column;
    const clause = `${bare}.in.(${scope.ids.join(",")}),${bare}.is.null`;
    return referencedTable ? query.or(clause, { referencedTable }) : query.or(clause);
  }
  return scope.ids.length === 1 ? query.eq(column, scope.ids[0]) : query.in(column, scope.ids);
}

// Quais corretores aparecem na tabela "Por corretor" (só admin geral/gestor veem a tabela).
export function breakdownBrokerIds(scope, profileIds = []) {
  if (!scope || scope.all) return profileIds;
  return profileIds.filter((id) => scope.ids.includes(id));
}
