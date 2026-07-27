"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AdminSimulationsError({ error, reset }) {
  useEffect(() => {
    console.error("Erro no Gerador de Simulacoes:", error);
  }, [error]);

  const detail = error?.message ? String(error.message) : "";

  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">
          Erro ao abrir gerador
        </p>
        <h1 className="mt-3 text-4xl font-black text-navy">
          Nao foi possivel carregar o Gerador de Simulacoes.
        </h1>
        <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">
          Recarregue a pagina. Se continuar, confira se as migrations do Supabase foram aplicadas.
        </p>
        {detail ? (
          <p className="mt-3 rounded-2xl border border-line bg-[#F8FBFF] px-5 py-4 text-sm font-bold text-muted">
            Detalhe: {detail}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button className="premium-button-primary" onClick={reset} type="button">
            Tentar novamente
          </button>
          <Link href="/admin" className="premium-button-secondary">
            Voltar ao painel
          </Link>
        </div>
      </section>
    </main>
  );
}
