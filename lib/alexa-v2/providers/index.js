import "server-only";
import { metaProvider, pendenciasProvider, prospeccaoProvider } from "./team";
import { etapaProvider, funilProvider, movimentoProvider } from "./funil";
import { agendaProvider } from "./agenda";
import { atendimentoProvider } from "./atendimento";
import { presencaProvider } from "./presenca";
import { rankingProvider, resultadosProvider } from "./resultados";
import { resumoProvider } from "./resumo";
import { corretorProvider } from "./corretor";

// Registro dos provedores da Alexa V2. Cada provedor lê a MESMA fonte da tela
// (ou o cache/snapshot pré-calculado) e devolve dados estruturados; a frase é
// montada pelo catálogo (lib/alexa-v2/catalog.mjs).
export function getV2Providers() {
  return {
    meta: metaProvider,
    prospeccao: prospeccaoProvider,
    pendencias: pendenciasProvider,
    funil: funilProvider,
    etapa: etapaProvider,
    movimento: movimentoProvider,
    agenda: agendaProvider,
    atendimento: atendimentoProvider,
    presenca: presencaProvider,
    resultados: resultadosProvider,
    ranking: rankingProvider,
    resumo: resumoProvider,
    corretor: corretorProvider
  };
}
