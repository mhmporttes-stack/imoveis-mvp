"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { FINANCEIRO_HOME, isFinanceiroApp } from "@/components/pwaHome";

// App "Financeiro" da tela inicial: nenhum caminho para outras áreas do painel. Qualquer rota
// /admin fora do Financeiro (e do login) volta para o Financeiro. Fora desse app não faz nada.
const ALLOWED = ["/admin/financeiro", "/admin/login", "/admin/reset-password"];

export default function FinanceiroAppGuard() {
  const pathname = usePathname() || "";
  useEffect(() => {
    if (!isFinanceiroApp()) return;
    if (ALLOWED.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return;
    window.location.replace(FINANCEIRO_HOME);
  }, [pathname]);
  return null;
}
