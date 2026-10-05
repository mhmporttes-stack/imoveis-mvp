"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import JourneyChoice from "@/components/simulation-form/JourneyChoice";
import QuickAttendanceForm from "@/components/simulation-form/QuickAttendanceForm";
import SimulationForm from "@/components/simulation-form/SimulationForm";

// Etapa nova na FRENTE do fluxo público já existente (Gerador de Links —
// campanha/?c=, link pessoal/?ref=, roleta/equipe) — a URL, o destino
// (corretor ou roleta) e a tag/campanha continuam exatamente os mesmos de
// sempre; só a experiência dentro do link ganhou uma escolha antes do
// formulário. Troca de tela via estado local (sem navegação/reload), então
// nada é criado só por abrir uma etapa — o cliente só entra no CRM quando
// realmente confirma um dos dois formulários.
export default function LinkJourneyGate({ brokerRefOverride = "" }) {
  const searchParams = useSearchParams();
  // ?jornada=simulacao (links dos Fluxos do WhatsApp): abre direto o formulário
  // de simulação, sem a tela de escolha com "Atendimento rápido". Sem esse
  // parâmetro nada muda — todo link existente continua mostrando a escolha.
  // Entrada (2026-10-04): a tela "Como podemos te ajudar?" (Atendimento rápido × Simulação) existe só para link de
  // CAMPANHA (?c=, configurado como "choice"). Link do Matheus (/simulacao), link individual do corretor (?ref=) e
  // link da equipe/roleta (/simulacao/equipe) abrem direto o formulário de Simulação — ?ref=, atribuição e roleta
  // seguem exatamente como antes (SimulationForm/track-view não mudam).
  const isCampaignLink = Boolean(searchParams.get("c"));
  const directSimulation = searchParams.get("jornada") === "simulacao" || !isCampaignLink;
  const [journey, setJourney] = useState(directSimulation ? "simulation" : "");
  // Quando a jornada foi definida automaticamente pelo link (Disparo do
  // WhatsApp Master com destino "Atendimento rápido"/"Simulação completa",
  // item 15-18 do pedido) o botão "Voltar" não deve existir — não há tela de
  // escolha anterior para voltar. "chosen" = veio do clique explícito na
  // tela de duas opções.
  const [journeySource, setJourneySource] = useState(directSimulation ? "direct_link" : "");
  const [resolvingLink, setResolvingLink] = useState(false);
  const campaignIdFromUrl = searchParams.get("c") || "";
  const refFromUrl = brokerRefOverride || searchParams.get("ref") || "";

  // Conta a ABERTURA do link (Gerador de Links > contador de aberturas) — só
  // quando a URL já chega com ?c= (campanha) ou ?ref= (link pessoal/oficial
  // do corretor/gestor/admin), nunca em navegação interna. Best-effort, mas
  // agora também resolve `linkJourney`: uma campanha do Disparo pode pedir
  // para pular a tela de escolha e abrir direto um dos dois formulários —
  // sem ?c=, o comportamento é exatamente o de sempre (tela de escolha).
  useEffect(() => {
    if (!campaignIdFromUrl && !refFromUrl) return;
    if (campaignIdFromUrl) setResolvingLink(true);
    fetch("/api/campaigns/track-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campaignIdFromUrl ? { campaignId: campaignIdFromUrl } : { ref: refFromUrl }),
      keepalive: true
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.linkJourney === "quick_service" || data?.linkJourney === "simulation") {
          setJourney(data.linkJourney);
          setJourneySource("direct_link");
        }
      })
      .catch(() => {})
      .finally(() => setResolvingLink(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignIdFromUrl, refFromUrl]);

  // Evita "piscar" a tela de escolha por uma fração de segundo antes do link
  // direto (Disparo) assumir o formulário certo.
  if (resolvingLink) return null;

  if (journey === "quick_service") {
    const canGoBack = journeySource !== "direct_link";
    return <QuickAttendanceForm brokerRefOverride={brokerRefOverride} journeySelected="quick_service" onBack={canGoBack ? () => setJourney("") : null} />;
  }

  if (journey === "simulation") {
    const canGoBack = journeySource !== "direct_link";
    return (
      <div>
        {/* Só o questionário na tela (sem título/subtítulo grandes): o cabeçalho continua para leitores de tela. */}
        <h1 className="sr-only">Simulação de financiamento</h1>
        {canGoBack ? (
          <div className="mx-auto mb-4 w-full max-w-3xl">
            <button
              className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition hover:text-brand"
              onClick={() => setJourney("")}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar
            </button>
          </div>
        ) : null}
        <SimulationForm brokerRefOverride={brokerRefOverride} journeySelected="simulation" />
      </div>
    );
  }

  return <JourneyChoice onSelect={(value) => { setJourney(value); setJourneySource("chosen"); }} />;
}
