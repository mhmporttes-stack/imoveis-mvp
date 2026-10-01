"use client";

import { useEffect } from "react";
import AdminBottomNav from "@/components/AdminBottomNav";
import AdminMenu from "@/components/AdminMenu";
import ClientWorkspace from "@/components/clients/ClientWorkspace";
import DailyGoalDashboard from "@/components/DailyGoalDashboard";
import PerformanceOverviewDashboard from "@/components/PerformanceOverviewDashboard";
import TeamDailyPerformance from "@/components/TeamDailyPerformance";
import WhatsappChat from "@/components/WhatsappChat";
import { installMockFetch } from "../_lib/mock-fetch";
import { FONTES } from "../_lib/fonts";
import Fundacao from "./Fundacao";
import * as comum from "../_fixtures/comum";
import * as clientes from "../_fixtures/clientes";
import * as chat from "../_fixtures/chat";
import * as metaDiaria from "../_fixtures/meta-diaria";
import * as desempenho from "../_fixtures/desempenho";

// Cada tela reproduz o <main> da página real (app/admin/...) com o
// componente real e dados 100% fictícios. Ao criar uma tela nova aqui,
// espelhe o wrapper da página correspondente.
const TELAS = {
  fundacao: {
    titulo: "Fundação (sistema visual)",
    active: "",
    rotas: [],
    semMenu: true,
    render: () => <Fundacao />
  },
  clientes: {
    path: "/admin/simulacoes",
    titulo: "Lista de clientes",
    active: "simulations",
    rotas: clientes.routes,
    render: (perfil) => (
      <main className="bg-mist py-14">
        <ClientWorkspace {...clientes.propsFor(perfil)} />
      </main>
    )
  },
  chat: {
    path: "/admin/chat",
    titulo: "Chat",
    active: "chat",
    rotas: chat.routes,
    render: (perfil) => (
      <main className="min-h-screen bg-mist py-14">
        <WhatsappChat {...chat.propsFor(perfil)} />
      </main>
    )
  },
  "meta-diaria": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária (corretor)",
    active: "daily-goal",
    rotas: metaDiaria.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} />
      </main>
    )
  },
  "meta-diaria-equipe": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária (visão do dono)",
    active: "daily-goal",
    rotas: metaDiaria.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <TeamDailyPerformance initialOverview={metaDiaria.teamOverview} />
      </main>
    )
  },
  desempenho: {
    path: "/admin/desempenho",
    titulo: "Desempenho",
    active: "performance",
    rotas: desempenho.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <PerformanceOverviewDashboard initialOverview={desempenho.overview} initialError="" />
      </main>
    )
  }
};

const PERFIS = {
  admin: { isAdmin: true },
  gestor: { isManager: true },
  corretor: { isBroker: true },
  associado: { isAssociate: true }
};

export default function VitrineClient({ tela, perfil, estado, limpo, fonte }) {
  const atual = TELAS[tela];
  const perfilValido = PERFIS[perfil] ? perfil : "admin";
  const fonteValida = FONTES[fonte] ? fonte : "manrope";

  // Instalado durante o render (antes dos efeitos dos filhos dispararem
  // o primeiro fetch). Idempotente.
  installMockFetch([...(atual?.rotas || []), ...comum.routes], estado);

  useEffect(() => {
    document.body.classList.add("admin-scroll-fix");
    return () => document.body.classList.remove("admin-scroll-fix");
  }, []);

  // Comparativo de tipografia: troca --font-ui só nesta página.
  useEffect(() => {
    const { className, stack } = FONTES[fonteValida];
    const root = document.documentElement;
    const classes = className ? className.split(" ") : [];
    root.classList.add(...classes);
    if (stack) root.style.setProperty("--font-ui", stack);
    return () => {
      root.classList.remove(...classes);
      root.style.removeProperty("--font-ui");
    };
  }, [fonteValida]);

  if (!atual) return <Indice />;

  return (
    <>
      {!limpo ? <BarraDev tela={tela} perfil={perfilValido} estado={estado} fonte={fonteValida} /> : null}
      {!atual.semMenu ? (
        <div className="bg-mist pt-6">
          <div className="container-page">
            <AdminMenu active={atual.active} {...PERFIS[perfilValido]} />
          </div>
        </div>
      ) : null}
      {atual.render(perfilValido)}
      <AdminBottomNav {...PERFIS[perfilValido]} currentPath={atual.path || ""} />
    </>
  );
}

function BarraDev({ tela, perfil, estado, fonte }) {
  const link = (next) => {
    const params = new URLSearchParams({ tela, perfil, estado, fonte, ...next });
    return `/dev/vitrine?${params.toString()}`;
  };
  return (
    <div className="sticky top-0 z-[100] flex flex-wrap items-center gap-2 bg-amber-300 px-3 py-1.5 text-xs font-bold text-black">
      <a href="/dev/vitrine" className="underline">Vitrine (dev)</a>
      <span>· {TELAS[tela].titulo}</span>
      <span>· perfil:</span>
      {Object.keys(PERFIS).map((item) => (
        <a key={item} href={link({ perfil: item })} className={item === perfil ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <span>· estado:</span>
      {["normal", "carregando", "erro"].map((item) => (
        <a key={item} href={link({ estado: item })} className={item === estado ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <span>· fonte:</span>
      {Object.keys(FONTES).map((item) => (
        <a key={item} href={link({ fonte: item })} className={item === fonte ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <a href={link({ limpo: "1" })} className="ml-auto opacity-70">sem esta barra</a>
    </div>
  );
}

function Indice() {
  return (
    <main className="container-page py-10">
      <h1 className="text-2xl font-black text-navy">Vitrine de componentes (somente desenvolvimento)</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Componentes reais com dados fictícios, sem login e sem tocar em API ou banco. Parâmetros: <code>tela</code>, <code>perfil</code> (admin, gestor, corretor, associado), <code>estado</code> (normal, carregando, erro) e <code>fonte</code> (atual, manrope, inter) e <code>limpo=1</code> para screenshot.
      </p>
      <ul className="mt-6 space-y-2">
        {Object.entries(TELAS).map(([key, item]) => (
          <li key={key}>
            <a className="font-bold text-brand underline" href={`/dev/vitrine?tela=${key}`}>{item.titulo}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
