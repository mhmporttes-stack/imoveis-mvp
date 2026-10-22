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
const AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#24507A"/><circle cx="32" cy="25" r="12" fill="#F3DCA6"/><path d="M10 60c3-13 12-19 22-19s19 6 22 19z" fill="#F3DCA6"/></svg>')}`;
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

export default function HenryDemo({ mode = "speaking", expanded = true, capturing = false, scene = "", topic = "relatorio" }) {
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
  const brokers =
    scene === "procurando"
      ? [{ id: "b1", firstName: "Ana", photoUrl: "", stats: [], found: false }]
      : scene === "corretor"
        ? [
            { id: "b1", firstName: "Ana", photoUrl: AVATAR, stats: [{ label: "pontos", value: "412" }, { label: "meta", value: "104%" }], found: true },
            { id: "b2", firstName: "Bruno", photoUrl: "", stats: [{ label: "pontos", value: "377" }, { label: "vendas", value: "2" }], found: true }
          ]
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
