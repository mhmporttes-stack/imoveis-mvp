import "server-only";
import { metaProvider, pendenciasProvider, prospeccaoProvider } from "./team";

// Registro dos provedores da Alexa V2. Cada provedor lê a MESMA fonte da tela
// (ou o cache/snapshot pré-calculado) e devolve dados estruturados; a frase é
// montada pelo catálogo. Os provedores entram etapa por etapa (3 e 4).
export function getV2Providers() {
  return {
    meta: metaProvider,
    prospeccao: prospeccaoProvider,
    pendencias: pendenciasProvider
  };
}
