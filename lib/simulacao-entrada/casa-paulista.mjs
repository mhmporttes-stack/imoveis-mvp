/**
 * FONTE ÚNICA do benefício Casa Paulista.
 *
 * REGRA OFICIAL (dono, 2026-10-02): é um benefício de VALOR FIXO de R$ 10.000,00.
 * Empreendimento que aceita (`regras.aceitaCasaPaulista`) → R$ 10.000 automaticamente;
 * que não aceita → R$ 0. Não é campo por cliente nem por simulação. Abate a entrada.
 * Nenhum componente/rota deve repetir o número: use `valorCasaPaulista`.
 */
export const CASA_PAULISTA_VALOR = 10000;

export function valorCasaPaulista(aceitaCasaPaulista) {
  return aceitaCasaPaulista ? CASA_PAULISTA_VALOR : 0;
}
