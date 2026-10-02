"use client";

import { useEffect } from "react";

// Só para a vitrine (dev): clica, em sequência, em botões/abas/resumos cujo texto contém cada passo.
// Uso: ?variante=Vendas|Marta|Comissão e repasses — facilita capturar telas em estados que exigem clique
// (a ferramenta de captura de tela da revisão visual nem sempre consegue clicar).
export default function AutoClick({ passos = "" }) {
  useEffect(() => {
    const steps = String(passos).split("|").map((step) => step.trim()).filter(Boolean);
    if (!steps.length) return undefined;
    
    let cancelled = false;
    (async () => {
      for (const step of steps) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (cancelled) return;
        const wanted = step.toLowerCase();
        const all = [...document.querySelectorAll("button, summary, [role='tab']")];
        const target = all.find((el) => el.textContent.trim().toLowerCase() === wanted) || all.find((el) => el.textContent.toLowerCase().includes(wanted));
        if (target) target.click();
        else console.warn(`[vitrine] passo sem alvo: ${step}`);
      }
    })();
    return () => { cancelled = true; };
  }, [passos]);
  return null;
}
