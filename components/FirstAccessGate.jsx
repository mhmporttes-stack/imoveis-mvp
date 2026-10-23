"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FIRST_ACCESS_STORAGE_KEY, firstAccessRedirect, saoPauloDateKey, shouldCheckFirstAccess } from "@/lib/primeiro-acesso-core.mjs";

// Primeiro acesso do dia do dono (docs/BUSINESS_RULES.md INI-4): montado em app/admin/layout.jsx só para o dono, fora
// de "Alterar conta" e fora dos apps Financeiro/Chat. Ao abrir o painel (ou voltar a ele com o app já aberto de outro
// dia), pergunta ao servidor; se for o primeiro acesso do dia, vai para o Início. A fala da Alexa é do servidor.
export default function FirstAccessGate() {
  const router = useRouter();

  useEffect(() => {
    let running = false;
    async function check() {
      if (running || document.visibilityState !== "visible") return;
      const today = saoPauloDateKey(new Date());
      let storedDay = "";
      try { storedDay = window.localStorage.getItem(FIRST_ACCESS_STORAGE_KEY) || ""; } catch {}
      const { pathname, search, hash } = window.location;
      if (!shouldCheckFirstAccess({ pathname, search, hash, storedDay, today })) return;
      running = true;
      try {
        const response = await fetch("/api/admin/primeiro-acesso", { method: "POST" });
        if (!response.ok) return; // tenta de novo na próxima vez que o painel voltar à tela
        const data = await response.json();
        try { window.localStorage.setItem(FIRST_ACCESS_STORAGE_KEY, data.day || today); } catch {}
        const target = data.firstOfDay ? firstAccessRedirect(window.location.pathname) : null;
        if (target) router.replace(target);
      } catch (error) {
        console.warn("Primeiro acesso do dia: não foi possível consultar.", error?.name || error);
      } finally {
        running = false;
      }
    }
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [router]);

  return null;
}
