"use client";

import { useCallback, useEffect, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";

// Vitrine DEV do Henry (HENRY-1): mesma apresentação do painel, com sinal de áudio SIMULADO e conversa fictícia.
const SAMPLE_TURNS = [
  { role: "user", text: "Bom dia, Henry" },
  { role: "assistant", text: "Bom dia, Matheus. Segue o relatório do dia. Hoje você tem 3 clientes aguardando resposta e 2 simulações a conferir." },
  { role: "user", text: "Henry, quem bateu a meta hoje?" },
  { role: "assistant", text: "Ana e Bruno já bateram a meta; a equipe está em 72%." }
];

// Cena de busca (dono, 2026-10-22): "buscando" = dados transparentes atrás do anel; "procurando corretor" = scanner;
// "achou corretor" = card com foto ligado ao anel; "relatório" = detalhe em lista na tela. Números e pessoas FICTÍCIOS.
const avatar = (bg, skin, hair) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><path d="M14 27c0-12 8-19 18-19s18 7 18 19c-3-5-9-8-18-8s-15 3-18 8z" fill="${hair}"/><circle cx="32" cy="27" r="11" fill="${skin}"/><path d="M10 64c3-13 12-19 22-19s19 6 22 19z" fill="#1E9BFF" opacity="0.85"/></svg>`)}`;
const AVATAR = avatar("#24507A", "#F3DCA6", "#3B2A1E");
const AVATAR_2 = avatar("#1B3B5E", "#D9A877", "#1A1410");
const SAMPLE_DETAIL = {
  title: "Relatório mensal",
  subtitle: "Últimos 30 dias (23/09 a 22/10)",
  sections: [
    { title: "Leads por origem", rows: [{ label: "Total", value: "214", note: "+12% (antes 191)" }, { label: "Anúncio", value: "128" }, { label: "Marketplace", value: "41" }, { label: "Outras origens", value: "45" }] },
    { title: "Funil", rows: [{ label: "Atendimento", value: "96" }, { label: "Simulação", value: "58" }, { label: "Documentação", value: "21" }, { label: "Enviados para aprovação", value: "12" }, { label: "Aprovados", value: "7" }, { label: "Vendas", value: "3", note: "igual" }] },
    { title: "Ranking e pontuação", rows: [{ label: "1º Ana", value: "412 pts" }, { label: "2º Bruno", value: "377 pts" }, { label: "3º Carla", value: "301 pts" }] },
    { title: "Meta Diária", rows: [{ label: "Equipe", value: "87%", note: "1.040 de 1.196 atividades" }] },
    { title: "Atenção agora", rows: [{ label: "Clientes aguardando resposta", value: "9" }, { label: "Clientes esfriados para você decidir", value: "2" }] }
  ]
};

export default function HenryDemo({ mode: initialMode = "speaking", expanded = true, capturing = false, scene = "", topic = "relatorio", brokerCount = 2 }) {
  // "achou" (redesenho da cena, 2026-10-22): busca 2,6 s → resposta 3,4 s, em ciclo, para ver entrada/busca/achou/saída.
  const [cycleSearching, setCycleSearching] = useState(true);
  useEffect(() => {
    if (scene !== "achou") return undefined;
    const id = setTimeout(() => setCycleSearching((value) => !value), cycleSearching ? 2600 : 3400);
    return () => clearTimeout(id);
  }, [scene, cycleSearching]);
  const mode = scene === "achou" ? (cycleSearching ? "thinking" : "speaking") : initialMode;
  const [muted, setMuted] = useState(false);
  const [vision, setVision] = useState(true);
  const [keyboard, setKeyboard] = useState(false);
  const [open, setOpen] = useState(expanded);
  // Sinal simulado com "sílabas" (picos curtos) para ver a reação ao volume em cada estado.
  const getSignal = useCallback(() => {
    const t = Date.now() / 1000;
    const syllables = Math.max(0, Math.sin(t * 9.1)) * (0.55 + 0.45 * Math.sin(t * 1.3));
    if (mode === "speaking") return { mode, level: 0.2 + 0.75 * syllables };
    if (mode === "listening") return { mode, level: 0.1 + 0.7 * syllables };
    return { mode, level: 0 };
  }, [mode]);
  const engaged = mode !== "idle";
  const allBrokers = [
    { id: "b1", firstName: "Ana", photoUrl: AVATAR, stats: [{ label: "pontos", value: "412" }, { label: "meta", value: "104%" }], position: 1, found: true },
    { id: "b2", firstName: "Bruno", photoUrl: "", stats: [{ label: "pontos", value: "377" }, { label: "vendas", value: "2" }], position: 2, found: true },
    { id: "b3", firstName: "Carla", photoUrl: AVATAR_2, stats: [{ label: "pontos", value: "301" }, { label: "meta", value: "88%" }], found: true }
  ];
  const brokers =
    scene === "procurando"
      ? [{ id: "b1", firstName: "Ana", photoUrl: AVATAR, stats: [], found: false }]
      : scene === "corretor"
        ? allBrokers.slice(0, Math.max(1, Math.min(3, brokerCount)))
        : [];
  const turns = scene === "relatorio" ? [...SAMPLE_TURNS.slice(0, 2), { role: "user", text: "Henry, quero o relatório mensal" }, { role: "assistant", text: "Nos últimos 30 dias entraram 214 leads, 128 de anúncio. Os detalhes estão na tela.", detail: SAMPLE_DETAIL }] : SAMPLE_TURNS;
  // Celular (< 768 px, ex.: 390×844): mesma apresentação do app, tocar para falar.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <HenryVoiceView
      expanded={open}
      onExpand={() => setOpen(true)}
      onMinimize={() => setOpen(false)}
      status={{ idle: "Ouvindo — diga “Henry”", listening: "Em conversa — pode falar sem dizer o nome (“obrigado, Henry” encerra)", thinking: "Pensando…", speaking: "Falando… diga “Henry” para interromper" }[mode] || ""}
      engaged={engaged}
      mobile={mobile}
      tapToTalk={mobile}
      inConversation={engaged}
      caption={{ thinking: SAMPLE_TURNS[2].text, speaking: SAMPLE_TURNS[3].text, listening: SAMPLE_TURNS[3].text }[mode] || ""}
      turns={turns}
      searching={mode === "thinking"}
      sceneTopic={topic}
      brokers={brokers}
      micOff={muted}
      onToggleMute={() => setMuted((value) => !value)}
      getSignal={getSignal}
      showKeyboard={keyboard}
      onToggleKeyboard={() => setKeyboard((value) => !value)}
      onSubmitTyped={(event) => event.preventDefault()}
      vision={vision}
      capturing={capturing}
      onToggleVision={() => setVision((value) => !value)}
    />
  );
}
