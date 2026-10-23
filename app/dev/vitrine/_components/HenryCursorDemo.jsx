"use client";

import { useCallback, useEffect, useState } from "react";
import HenryCursor from "@/components/henry/HenryCursor";

// Vitrine DEV da navegação guiada do Henry: menu e card de mentira com os mesmos data-attributes do painel
// (data-henry-target / data-henry-client-id). O cursor desliza até "Clientes", clica, depois vai ao card e clica.
// Nada navega de verdade (onNavigate só marca o item). Repete a cada 4 s.
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const MENU = [
  ["/admin/inicio", "Início"],
  ["/admin/simulacoes", "Clientes"],
  ["/admin/chat", "Chat"],
  ["/admin/meta-diaria", "Meta Diária"],
  ["/admin/desempenho", "Desempenho"]
];

export default function HenryCursorDemo() {
  const [request, setRequest] = useState(null);
  const [current, setCurrent] = useState("/admin/inicio");
  const [opened, setOpened] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setMobile(window.matchMedia("(max-width: 767px)").matches);
    const onOpen = () => setOpened(true);
    window.addEventListener("mm:henry-open-client", onOpen);
    const start = () => {
      setCurrent("/admin/inicio");
      setOpened(false);
      setRequest({ id: Date.now(), path: `/admin/simulacoes?clientId=${CLIENT_ID}`, label: "ficha de Maria", clientId: CLIENT_ID });
    };
    const first = window.setTimeout(start, 600);
    const loop = window.setInterval(start, 4000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(loop);
      window.removeEventListener("mm:henry-open-client", onOpen);
    };
  }, []);
  const onNavigate = useCallback((path) => setCurrent(path.split("?")[0]), []);
  const menu = (
    <nav className={mobile ? "fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-line bg-white" : "fixed inset-y-0 left-0 z-30 w-[76px] border-r border-line bg-white pt-20"}>
      {MENU.map(([href, label]) => (
        <a key={href} href={href} data-henry-target={href} onClick={(event) => event.preventDefault()} className={`${mobile ? "px-2 text-[10px]" : "mx-2 mb-2 flex h-11 items-center justify-center rounded-lg text-[10px]"} font-semibold ${current === href ? "bg-accent-soft text-accent-text" : "text-muted"}`}>
          {label}
        </a>
      ))}
    </nav>
  );
  return (
    <main className="min-h-screen bg-mist" style={{ paddingLeft: mobile ? 0 : 96, paddingTop: 40 }}>
      {menu}
      <div className="mx-auto max-w-3xl space-y-3 px-4">
        <p className="text-sm font-bold text-navy">{current === "/admin/simulacoes" ? "Clientes" : "Início"}</p>
        {current === "/admin/simulacoes"
          ? ["Ana", "Maria", "João"].map((name) => (
              <article key={name} data-henry-client-id={name === "Maria" ? CLIENT_ID : undefined} className={`rounded-xl border bg-white p-4 ${name === "Maria" && opened ? "border-brand ring-1 ring-brand" : "border-line"}`}>
                <p className="font-bold text-navy">{name} {name === "Maria" ? "Souza" : "Lima"}</p>
                <p className="text-xs text-muted">Em atendimento · Ana</p>
              </article>
            ))
          : <div className="h-40 rounded-xl border border-line bg-white" />}
        {opened ? <p className="text-xs font-bold text-accent-text">Ficha da Maria aberta</p> : null}
      </div>
      <HenryCursor request={request} mobile={mobile} onNavigate={onNavigate} />
    </main>
  );
}
