"use client";

import { useEffect } from "react";
import { wipeDeviceCache } from "@/components/device-view-cache";

// Tela de login (sem sessão válida — saiu, a sessão expirou ou outra pessoa vai entrar): apaga o que as telas do painel
// guardaram no aparelho (dono, 2026-10-26 — components/device-view-cache.js). Não abre o banco do aparelho se nunca houve.
export default function DeviceCacheWipe() {
  useEffect(() => {
    wipeDeviceCache();
  }, []);
  return null;
}
