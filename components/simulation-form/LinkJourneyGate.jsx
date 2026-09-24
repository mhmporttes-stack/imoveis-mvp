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
  const directSimulation = searchParams.get("jornada") === "simulacao";
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
        <div className="mx-auto mb-9 max-w-4xl text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-brand">Financiamento imobiliário</p>
          <h1 className="mt-4 text-[clamp(2.4rem,5vw,4.75rem)] font-black leading-[0.98] text-navy">
            Simulação de financiamento
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[clamp(1rem,1.8vw,1.25rem)] leading-8 text-muted">
            Responda algumas perguntas para entendermos o seu perfil e avaliarmos as melhores possibilidades de financiamento.
          </p>
        </div>
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
