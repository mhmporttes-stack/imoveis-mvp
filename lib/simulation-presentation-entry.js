import "server-only";
import { getProperty } from "./properties";
import { simularEntrada } from "./simulacao-entrada/calculator";
import { clienteEntradaFromSimulation } from "./simulacao-entrada/cliente-entrada";
import { aplicarParcelasManuais } from "./simulacao-entrada/presentation-model.mjs";
import { getEmpreendimentoRegras } from "./simulacao-entrada/repository";

/**
 * Resultado do motor de entrada de CADA imóvel sugerido, para a cena de valores da apresentação (PRES-20).
 *
 * É a MESMA conta que a tela do card do cliente → Empreendimento (`components/EmpreendimentoPresentation.jsx` →
 * `/api/simular-entrada`) e o PDF "Proposta de Valores" (`app/api/simulations/[id]/proposta-valores/route.js`) fazem, com os
 * mesmos ingredientes: `clienteEntradaFromSimulation(simulation)`, as regras cadastradas do empreendimento (`empreendimentos.regras`,
 * sem ajuste manual de ato/parcelas) e os diferenciais do cadastro do imóvel (`properties.features`, usados na documentação
 * gratuita). Nenhuma fórmula nova: só orquestra o motor (`simularEntrada`, não alterado). Nada é gravado.
 *
 * Devolve `{ [propertyId]: { result, features } }`. Imóvel sem regras de entrada ativas, ou com falha ao calcular, simplesmente
 * não entra no mapa (a cena de valores não existe para ele; o erro vai para o log, nunca para o visitante).
 */
export async function loadPropertyEntryResults(simulation) {
  const ids = [...new Set((simulation?.properties || []).map((property) => String(property?.propertyId || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const cliente = clienteEntradaFromSimulation(simulation);
  const entries = await Promise.all(ids.map(async (propertyId) => {
    try {
      const [row, property] = await Promise.all([getEmpreendimentoRegras(propertyId), getProperty(propertyId)]);
      if (!row || row.ativo === false || !row.regras) return null;
      const result = simularEntrada(cliente, aplicarParcelasManuais(row.regras, 0), { atoDesejado: 0 });
      return [propertyId, { result, features: Array.isArray(property?.features) ? property.features : [] }];
    } catch (error) {
      console.error(`[apresentacao] nao foi possivel calcular a entrada do imovel ${propertyId}:`, error?.message || error);
      return null;
    }
  }));
  return Object.fromEntries(entries.filter(Boolean));
}
