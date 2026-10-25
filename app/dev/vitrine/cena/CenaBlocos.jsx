"use client";

import { useEffect, useState } from "react";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";

function Card({ n, children }) {
  return (
    <section className="mx-auto mb-4 w-full max-w-3xl rounded-card border border-line bg-white p-5 shadow-soft">
      <h2 className="text-lg font-extrabold text-navy">Bloco {n}</h2>
      {children}
    </section>
  );
}

export function PaginaLeve() {
  return (
    <div className="p-6">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <Card key={n} n={n}>
          <p className="mt-2 text-sm text-ink-2">Tela de origem (fictícia).</p>
          {n === 1 ? <SceneTransitionLink href="/dev/vitrine/cena/b" direction="forward" className="mt-3 inline-block rounded-control bg-brand px-4 py-2 text-sm font-bold text-white">Ir para a pesada</SceneTransitionLink> : null}
        </Card>
      ))}
    </div>
  );
}

// Simula a montagem de uma tela cheia (Meta Diária): lista grande no 1º render e outra, maior, quando "chegam os dados".
export function PaginaPesada() {
  const [rows, setRows] = useState(400);
  useEffect(() => {
    const t = setTimeout(() => setRows(2600), 120);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="p-6">
      <Card n="1">
        <p className="mt-2 text-sm text-ink-2">Tela de destino (fictícia).</p>
        <SceneTransitionLink href="/dev/vitrine/cena/a" direction="backward" className="mt-3 inline-block rounded-control bg-brand px-4 py-2 text-sm font-bold text-white">Voltar</SceneTransitionLink>
      </Card>
      {[2, 3, 4].map((n) => <Card key={n} n={n}><p className="mt-2 text-sm text-ink-2">Resumo.</p></Card>)}
      <Card n="5">
        <ul>
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center justify-between border-b border-line py-1 text-xs"><span className="font-bold text-navy">Cliente {i + 1}</span><span className="rounded-chip bg-mist px-2 py-0.5">{(i * 37) % 100}%</span><span className="text-muted">tentativa {(i * 7) % 13}</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
