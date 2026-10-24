"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";
import HenryLockScreen, { HenryUnlockedBadge } from "@/components/henry/HenryLockScreen";
import { seededRandom } from "@/lib/henry-pulse-ambient-core.mjs";

// Vitrine DEV da tela de bloqueio do Henry (HENRY-LOCK). Só no `next dev`. A "senha" aqui é FICTÍCIA (123456, só nesta
// vitrine; o painel confere no servidor). ?bloqueio=1 bloqueada · =digitando (3 asteriscos) · =erro (tremor)
// · =teclado (celular com o teclado numérico) · =aberto (desbloqueado) · =ambiente (modo ambiente acelerado ×20, sorteio
// fixo: cards inventados, sem dado real). Digitar 123456 (teclado físico ou numérico) toca a cena do desbloqueio.
const DEMO_PIN = "123456";

export default function HenryLockDemo({ variant = "1" }) {
  const [mobile, setMobile] = useState(false);
  const [unlocked, setUnlocked] = useState(variant === "aberto");
  const [keypad, setKeypad] = useState(variant === "teclado");
  const [unlockFx, setUnlockFx] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const getSignal = useCallback(() => ({ mode: "idle", level: 0 }), []);
  const ambientRandom = useMemo(() => (variant === "ambiente" ? seededRandom(7) : null), [variant]);
  const onSubmit = useCallback(async (pin) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return pin === DEMO_PIN ? { ok: true } : { ok: false, error: "Senha incorreta." };
  }, []);
  const turns =
    variant === "ambiente"
      ? []
      : unlocked
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
      notice={variant === "aviso" ? "Não entendi. Toque no Henry e fale de novo." : ""}
      getSignal={getSignal}
      onToggleMute={() => {}}
      onToggleKeyboard={() => {}}
      onToggleVision={() => {}}
      morningPlay
      onMorningPlay={() => {}}
      locked={!unlocked}
      lockKeypadOpen={keypad}
      unlockFx={unlockFx}
      ambientRandom={ambientRandom}
      ambientSpeed={variant === "ambiente" ? 20 : 1}
      lockLayer={
        unlocked ? (
          <HenryUnlockedBadge onLock={() => setUnlocked(false)} />
        ) : (
          <HenryLockScreen
            key={variant}
            mobile={mobile}
            inline={mobile}
            keypadOpen={keypad}
            onKeypadChange={setKeypad}
            onSubmit={onSubmit}
            onUnlocked={() => {
              setUnlocked(true);
              setUnlockFx(Date.now());
            }}
            demoDigits={demoDigits}
            demoShake={variant === "erro"}
          />
        )
      }
    />
  );
}
