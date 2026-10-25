"use client";

import { useState } from "react";
import DailyMessageExperience from "@/components/DailyMessageExperience";
import CelebrationOverlay from "@/components/celebrations/CelebrationOverlay";
import DailyGoalDashboard from "@/components/DailyGoalDashboard";
import * as metaDiaria from "../_fixtures/meta-diaria";

// Cenas do visual novo (2026-10-22) com dados FICTÍCIOS. ?tela=cenas&variante=
//   mensagem | mensagem-longa | reconhecimento[:gatilho[:animação]] | meta | meta-dia[:repete]
// Tema escuro: adicionar a classe mm-dark no <html> (o script de screenshot faz isso).
const FOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FB8D8"/><stop offset="1" stop-color="#2F5F86"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="82" r="38" fill="#F1D3BC"/><path d="M30 200c6-48 36-72 70-72s64 24 70 72z" fill="#1E3A57"/><path d="M62 78c0-30 18-46 38-46s38 16 38 46c-8-14-22-20-38-20s-30 6-38 20z" fill="#3B2A20"/></svg>'
)}`;

const CARDS = {
  mensagem: { id: "v1", type: "biblical", mainText: "Tudo posso naquele que me fortalece.", sourceText: "Filipenses 4:13", openingMessage: "Comece pelo cliente que está esperando resposta. Um atendimento bem feito hoje é uma família mais perto da primeira chave." },
  "mensagem-longa": { id: "v2", type: "reflection", mainText: "Cada cliente atendido hoje é uma família mais perto da primeira chave. Responda rápido e acompanhe até o fim.", sourceText: "Reflexão da equipe", openingMessage: "Bom trabalho hoje." }
};

export default function Cenas({ variante = "mensagem" }) {
  const [kind, a = "", b = ""] = String(variante || "mensagem").split(":");
  const [round, setRound] = useState(0);

  if (kind === "mensagem" || kind === "mensagem-longa") {
    return <DailyMessageExperience key={round} card={CARDS[kind]} userName="Ana Paula Ribeiro" onComplete={() => setRound((n) => n + 1)} />;
  }
  if (kind === "reconhecimento") {
    const trigger = a || "ranking_no1";
    const message = trigger === "ranking_no1" ? "Você assumiu o 1º lugar." : "Ana, meta do dia batida! Bora pra cima.";
    return (
      <main className="min-h-screen bg-mist">
        <CelebrationOverlay key={round} message={message} animation={b || "confete"} triggerKey={trigger} userName="Ana Paula Ribeiro" userPhotoUrl={FOTO} onDismiss={() => setRound((n) => n + 1)} />
      </main>
    );
  }
  if (kind === "meta") {
    // Mesmo objeto da tela real (percentual calculado pela fixture com a regra da Meta), nunca um número solto.
    return (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} brokerName="Ana Paula Ribeiro" brokerPhotoUrl={FOTO} />
      </main>
    );
  }
  if (kind === "meta-dia") {
    // Cena do primeiro acesso do dia (2026-10-25): cada carregamento usa uma conta nova, então sempre é "o primeiro acesso do dia".
    // ?variante=meta-dia:repete reaproveita a conta (a cena NÃO toca na 2ª visita do dia).
    return (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} brokerName="Ana Paula Ribeiro" brokerPhotoUrl={FOTO} viewerKey={a === "repete" ? "vitrine-fixa" : `vitrine-${Math.random().toString(36).slice(2)}`} />
      </main>
    );
  }
  return <p className="p-10">Variante desconhecida.</p>;
}
