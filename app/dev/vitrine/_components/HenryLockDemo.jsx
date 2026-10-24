"use client";

import { useCallback, useEffect, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";
import HenryLockScreen, { HenryUnlockedBadge } from "@/components/henry/HenryLockScreen";

// Vitrine DEV da tela de bloqueio do Henry (HENRY-LOCK, dono 2026-10-23). Só no `next dev`. A "senha" aqui é FICTÍCIA
// (123456, só nesta vitrine; o painel confere no servidor). ?bloqueio=1 bloqueada · =digitando (3 asteriscos)
// · =erro (tremor) · =teclado (celular com o teclado numérico) · =aberto (desbloqueado, cadeado aberto no canto).
const DEMO_PIN = "123456";

export default function HenryLockDemo({ variant = "1" }) {
  const [mobile, setMobile] = useState(false);
  const [unlocked, setUnlocked] = useState(variant === "aberto");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const getSignal = useCallback(() => ({ mode: "idle", level: 0 }), []);
  const onSubmit = useCallback(async (pin) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (pin === DEMO_PIN) {
      setUnlocked(true);
      return { ok: true };
    }
    return { ok: false, error: "Senha incorreta." };
  }, []);
  const turns = unlocked
    ? [{ role: "user", text: "Henry, quantos clientes aguardam resposta?" }, { role: "assistant", text: "São 9 aguardando resposta, 4 com a Ana." }]
    : [{ role: "user", text: "Henry, quantos clientes aguardam resposta?" }, { role: "assistant", text: "Pra isso preciso que você desbloqueie com a senha." }];
  const demoDigits = variant === "digitando" ? "123" : variant === "erro" ? "" : null;
  return (
    <HenryVoiceView
      expanded
      fixed
      mobile={mobile}
      tapToTalk={mobile}
      status="Ouvindo — pode falar"
      turns={turns}
      getSignal={getSignal}
      onToggleMute={() => {}}
      onToggleKeyboard={() => {}}
      locked={!unlocked}
      lockLayer={
        unlocked ? (
          <HenryUnlockedBadge onLock={() => setUnlocked(false)} />
        ) : (
          <HenryLockScreen key={variant} mobile={mobile} onSubmit={onSubmit} keypadDefault={variant === "teclado"} demoDigits={demoDigits} demoShake={variant === "erro"} />
        )
      }
    />
  );
}
