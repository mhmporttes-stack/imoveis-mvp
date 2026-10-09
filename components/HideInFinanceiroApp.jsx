"use client";

import { useEffect, useState } from "react";
import { isFinanceiroApp } from "@/components/pwaHome";

// Não monta o conteúdo (popups, mensagens, celebrações) dentro do app "Financeiro" da tela inicial.
export default function HideInFinanceiroApp({ children }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(isFinanceiroApp()); }, []);
  return hidden ? null : children;
}
