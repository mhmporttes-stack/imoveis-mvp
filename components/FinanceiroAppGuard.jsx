"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MM_APPS, getMmApp } from "@/components/pwaHome";

// Apps "Financeiro" e "Chat" da tela inicial: nenhum caminho para outras áreas do painel. Qualquer rota
// /admin fora da área do app (e do login) volta para a casa do app. Fora desses apps não faz nada.
const ALWAYS = ["/admin/login", "/admin/reset-password"];

export default function FinanceiroAppGuard() {
  const pathname = usePathname() || "";
  useEffect(() => {
    const app = getMmApp();
    if (!app) return;
    const allowed = [...MM_APPS[app].allowed, ...ALWAYS];
    if (allowed.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return;
    window.location.replace(MM_APPS[app].home);
  }, [pathname]);
  return null;
}
