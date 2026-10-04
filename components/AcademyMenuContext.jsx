"use client";

import { createContext, useContext } from "react";

// A chave da Academia é server-only: app/admin/layout.jsx lê a chave e a
// entrega ao menu por este contexto. Padrão false — fora do provider (vitrine,
// qualquer outro uso) o menu fica idêntico ao de antes.
const AcademyMenuContext = createContext(false);

export function AcademyMenuProvider({ enabled = false, children }) {
  return <AcademyMenuContext.Provider value={Boolean(enabled)}>{children}</AcademyMenuContext.Provider>;
}

export function useAcademyMenuEnabled() {
  return useContext(AcademyMenuContext);
}
