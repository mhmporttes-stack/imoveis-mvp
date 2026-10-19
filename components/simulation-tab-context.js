"use client";

import { createContext, useContext } from "react";

// Contexto da aba da simulação (redesenho 2026-10-19, designer-crm). A página (app/admin/simulacoes/[id]/page.jsx)
// monta os blocos já existentes (conferência, refazer, comparar, apresentação) e o Gerador os posiciona no layout novo.
// O contexto só muda a APRESENTAÇÃO desses blocos dentro da aba; fora dela (ex.: ficha do cliente) eles seguem iguais.
//   reviewExtras: { before, actions } — conteúdo extra da faixa de conferência (renda para a Caixa; botão Refazer)
//   compactPresentation: painel da apresentação na coluna de envio (sem título grande, "Gerar" vira link secundário)
//   embeddedScenarios: "Comparar simulações" como aba (aberto e carregado ao montar, sem o botão de abrir/fechar)
export const SimulationTabContext = createContext(null);

export function useSimulationTab() {
  return useContext(SimulationTabContext);
}
