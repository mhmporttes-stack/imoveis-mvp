"use client";

import { useCallback, useEffect, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";
import HenryLockScreen, { HenryUnlockedBadge } from "@/components/henry/HenryLockScreen";
import HenryPasskeyUnlockButton from "@/components/henry/HenryPasskeyUnlockButton";
import HenryPasskeySettings from "@/components/henry/HenryPasskeySettings";

// Vitrine DEV da tela de bloqueio do Henry (HENRY-LOCK, dono 2026-10-23). Só no `next dev`. A "senha" aqui é FICTÍCIA
// (123456, só nesta vitrine; o painel confere no servidor). ?bloqueio=1 bloqueada · =digitando (3 asteriscos)
// · =erro (tremor) · =teclado (celular com o teclado numérico) · =aberto (desbloqueado, cadeado aberto no canto)
// · =faceid (botão do Face ID ao lado dos cadeados, 2026-10-24) · =faceid-cartao (cadastro no cartão, aparelhos FICTÍCIOS).
const DEMO_PASSKEYS = {
  available: true,
  devices: [
    { id: "demo-1", deviceName: "iPhone — 24/10/2026", createdAt: "2026-10-24T12:10:00Z", lastUsedAt: "2026-10-24T14:32:00Z" },
    { id: "demo-2", deviceName: "Windows (app do CRM) — 24/10/2026", createdAt: "2026-10-24T12:20:00Z", lastUsedAt: null }
  ]
};
const DEMO_PIN = "123456";

export default function HenryLockDemo({ variant = "1" }) {
  if (variant === "faceid-cartao") {
    return (
      <main className="min-h-screen bg-mist p-4 md:p-10">
        <div className="mx-auto max-w-3xl rounded-card border border-line bg-white p-5">
          <p className="text-sm font-black text-navy">Tela de bloqueio</p>
          <HenryPasskeySettings demoState={DEMO_PASSKEYS} />
        </div>
      </main>
    );
  }
  return <HenryLockDemoScreen variant={variant} />;
}

function HenryLockDemoScreen({ variant }) {
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
          <HenryLockScreen key={variant} mobile={mobile} onSubmit={onSubmit} keypadDefault={variant === "teclado"} demoDigits={demoDigits} demoShake={variant === "erro"} accessory={variant === "faceid" ? <HenryPasskeyUnlockButton demo /> : null} />
        )
      }
    />
  );
}
