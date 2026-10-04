"use client";

// Vitrine DEV da gestão da Academia (só `next dev`; *.dev.jsx não entra no build). Renderiza o MESMO EditorApp, sem login e
// sem a chave ACADEMIA_ENABLED; as chamadas à API ficam por conta de quem testa (ex.: Playwright com page.route).
// ?ro=1 abre em somente leitura ("Alterar conta").
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import EditorApp from "@/components/academia/editor/EditorApp";

function Demo() {
  const q = useSearchParams();
  return <EditorApp readOnly={q.get("ro") === "1"} backHref="/dev/vitrine" />;
}

export default function EditorVitrine() {
  return <Suspense fallback={null}><Demo /></Suspense>;
}
