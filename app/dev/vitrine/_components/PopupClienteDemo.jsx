"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClientPopupStackView } from "@/components/client-popups/ClientPopupStack";
import { visibleClientPopups } from "@/lib/client-popup-view-core.mjs";

// Janelinha de cliente novo (CLI-16) com dados FICTÍCIOS. ?variante=1 (uma) | 3 (três) | 5 (três + "+2").
const MIN = 60 * 1000;

function fixtures(now) {
  return [
    { key: "v1", kind: "new", clientName: "Ana Paula Ferreira", origin: "Link da roleta", at: new Date(now - 1 * MIN).toISOString(), href: "#" },
    { key: "v2", kind: "transfer", clientName: "Carlos Henrique Lima", fromName: "Jennyfer", origin: "Formulário do site", at: new Date(now - 6 * MIN).toISOString(), href: "#" },
    { key: "v3", kind: "messenger", clientName: "Marcos Vinícius", origin: "Facebook Marketplace — Casa 2 quartos", at: new Date(now - 14 * MIN).toISOString(), href: "#" },
    { key: "v4", kind: "new", clientName: "Juliana Santos", origin: "WhatsApp — Contato direto", at: new Date(now - 40 * MIN).toISOString(), href: "#" },
    { key: "v5", kind: "new", clientName: "Roberto Alves", origin: "Cadastro manual — Carol", at: new Date(now - 95 * MIN).toISOString(), href: "#" }
  ];
}

export default function PopupClienteDemo({ variante = "1" }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setState({ isMobile: query.matches, now: Date.now() });
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!state) return null;
  const count = Math.max(1, Math.min(5, Number(variante) || 1));
  const { visible, extra } = visibleClientPopups(fixtures(state.now).slice(0, count));
  // No painel a janelinha fica no layout, fora do <main>; aqui vai para o body (a entrada por rolagem da vitrine esconderia).
  return createPortal(<ClientPopupStackView items={visible} extra={extra} isMobile={state.isMobile} now={state.now} onOpen={() => {}} onMore={() => {}} />, document.body);
}
