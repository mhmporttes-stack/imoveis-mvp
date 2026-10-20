"use client";

import { useEffect } from "react";
import Button from "@/components/ui/Button";

// Tela de erro do painel (qualquer tela de /admin sem tela de erro própria — ex.: app/admin/simulacoes/error.jsx tem a
// sua). Mensagem simples, sem detalhe técnico para o usuário; o erro completo vai para o console do navegador.
export default function AdminError({ error, reset }) {
  useEffect(() => {
    console.error("Erro no painel:", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-mist px-4 py-14">
      <section className="w-full max-w-md rounded-[24px] border border-line bg-white p-8 text-center shadow-soft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/matheus-machado-symbol.png" alt="Matheus Machado Corretor de Imóveis" width={56} height={56} className="mx-auto h-14 w-14 object-contain" />
        <h1 className="mt-5 text-2xl font-black text-navy">Algo deu errado nesta tela</h1>
        <p className="mt-3 text-sm font-semibold text-muted">
          Não foi possível carregar agora. Tente de novo; se continuar, volte ao início e avise a gestão.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={() => reset()}>Tentar de novo</Button>
          <Button href="/admin" variant="secondary">Voltar ao início</Button>
        </div>
      </section>
    </main>
  );
}
