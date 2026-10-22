"use client";

import { useCallback, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";

// Vitrine DEV do Henry (HENRY-1): mesma apresentação do painel, com sinal de áudio SIMULADO e conversa fictícia.
const SAMPLE_TURNS = [
  { role: "user", text: "Bom dia, Henry" },
  { role: "assistant", text: "Bom dia, Matheus. Segue o relatório do dia. Hoje você tem 3 clientes aguardando resposta e 2 simulações a conferir." },
  { role: "user", text: "Henry, quem bateu a meta hoje?" },
  { role: "assistant", text: "Ana e Bruno já bateram a meta; a equipe está em 72%." }
];

export default function HenryDemo({ mode = "speaking", expanded = true }) {
  const [muted, setMuted] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [open, setOpen] = useState(expanded);
  const getSignal = useCallback(() => {
    const t = Date.now() / 1000;
    if (mode === "speaking") return { mode, level: 0.35 + 0.35 * Math.abs(Math.sin(t * 5.3)) * (0.6 + 0.4 * Math.sin(t * 1.7)) };
    if (mode === "listening") return { mode, level: 0.2 + 0.15 * Math.abs(Math.sin(t * 3.1)) };
    return { mode, level: 0 };
  }, [mode]);
  return (
    <HenryVoiceView
      expanded={open}
      onExpand={() => setOpen(true)}
      onMinimize={() => setOpen(false)}
      status={{ idle: "Ouvindo — diga “Henry”", listening: "Pode falar…", thinking: "Pensando…", speaking: "Falando… diga “Henry” para interromper" }[mode] || ""}
      turns={SAMPLE_TURNS}
      micOff={muted}
      onToggleMute={() => setMuted((value) => !value)}
      getSignal={getSignal}
      showKeyboard={keyboard}
      onToggleKeyboard={() => setKeyboard((value) => !value)}
      onSubmitTyped={(event) => event.preventDefault()}
    />
  );
}
