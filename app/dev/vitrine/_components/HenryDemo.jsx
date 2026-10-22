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

export default function HenryDemo({ mode = "speaking", expanded = true, capturing = false }) {
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
      turns={SAMPLE_TURNS}
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
