"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { saoPauloDateStr } from "@/lib/daily-goal-policy-core.mjs";

// Meta Diária pré-carregada ou reaproveitada (regra do dono, 2026-10-12: a Meta do dia pode ser montada quando o app
// abre): se a tela foi montada num dia (São Paulo) e está sendo vista em outro, pede a tela de novo ao servidor —
// que roda o mesmo caminho de sempre (fecha o dia anterior, gera o dia novo). Nunca mostra ontem como se fosse hoje.
// Confere ao abrir e ao voltar para o app (tela deixada aberta de um dia para o outro).
export default function MetaDayGuard({ day = "" }) {
  const router = useRouter();
  useEffect(() => {
    if (!day) return undefined;
    const check = () => {
      if (document.visibilityState === "visible" && saoPauloDateStr() !== day) router.refresh();
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [day, router]);
  return null;
}
