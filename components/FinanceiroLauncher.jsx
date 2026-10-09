"use client";

import { useEffect, useState } from "react";
import { FINANCEIRO_HOME, isStandaloneApp, setPwaHome } from "@/components/pwaHome";

export default function FinanceiroLauncher() {
  const [standalone, setStandalone] = useState(null);

  useEffect(() => {
    const app = isStandaloneApp();
    setStandalone(app);
    if (app) {
      setPwaHome(FINANCEIRO_HOME);
      window.location.replace(FINANCEIRO_HOME);
    }
  }, []);

  return (
    <main className="grid min-h-[70vh] place-items-center bg-mist px-4 py-14">
      <section className="w-full max-w-[440px] rounded-[28px] border border-line bg-white p-8 text-center shadow-soft">
        <img src="/icons/icon-financeiro-192-mm.png" alt="" width={88} height={88} className="mx-auto rounded-[20px]" />
        <h1 className="mt-5 text-3xl font-black text-navy">Financeiro</h1>
        {standalone ? (
          <p className="mt-3 text-muted">Abrindo o Financeiro…</p>
        ) : (
          <>
            <p className="mt-3 leading-7 text-muted">Para ter o Financeiro na tela inicial do iPhone: toque em <strong>Compartilhar</strong> no Safari e depois em <strong>Adicionar à Tela de Início</strong>.</p>
            <a href={FINANCEIRO_HOME} className="mt-6 inline-flex rounded-full bg-navy px-6 py-3 font-bold text-white">Abrir o Financeiro</a>
          </>
        )}
      </section>
    </main>
  );
}
