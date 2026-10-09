"use client";

import { useEffect, useState } from "react";
import { MM_APPS, isStandaloneApp, setPwaHome } from "@/components/pwaHome";

const COPY = {
  financeiro: { title: "Financeiro", icon: "/icons/icon-financeiro-192-mm.png", open: "Abrir o Financeiro" },
  chat: { title: "Chat", icon: "/icons/icon-chat-192-v3-mm.png", open: "Abrir o Chat" }
};

// Página de instalação dos atalhos da tela inicial (/financeiro, /chat-app).
export default function FinanceiroLauncher({ app = "financeiro" }) {
  const home = MM_APPS[app].home;
  const copy = COPY[app];
  const [standalone, setStandalone] = useState(null);

  useEffect(() => {
    const app = isStandaloneApp();
    setStandalone(app);
    if (app) {
      setPwaHome(home);
      window.location.replace(home);
    }
  }, [home]);

  return (
    <main className="grid min-h-[70vh] place-items-center bg-mist px-4 py-14">
      <section className="w-full max-w-[440px] rounded-[28px] border border-line bg-white p-8 text-center shadow-soft">
        <img src={copy.icon} alt="" width={88} height={88} className="mx-auto rounded-[20px]" />
        <h1 className="mt-5 text-3xl font-black text-navy">{copy.title}</h1>
        {standalone ? (
          <p className="mt-3 text-muted">Abrindo o {copy.title}…</p>
        ) : (
          <>
            <p className="mt-3 leading-7 text-muted">Para ter o {copy.title} na tela inicial do iPhone, abra esta página no <strong>Safari</strong> (pelo Chrome o atalho abre o navegador com o sistema inteiro), toque em <strong>Compartilhar</strong>, depois em <strong>Adicionar à Tela de Início</strong> e deixe <strong>Abrir como App Web</strong> ligado.</p>
            <a href={home} className="mt-6 inline-flex rounded-full bg-navy px-6 py-3 font-bold text-white">{copy.open}</a>
          </>
        )}
      </section>
    </main>
  );
}
