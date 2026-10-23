"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { henryJustClosed, isHenryFullscreenOpen, subscribeHenryFullscreen } from "@/lib/henry-fullscreen-signal.mjs";

const getSnapshot = () => isHenryFullscreenOpen();
const getServerSnapshot = () => false;
const subscribe = (callback) => subscribeHenryFullscreen(callback);

// `true` enquanto a tela cheia do Henry está aberta (lib/henry-fullscreen-signal.mjs). Avisos fixos no meio da tela não
// aparecem nesse tempo e voltam sozinhos ao fechar; `onClose` (opcional) roda uma vez quando a cena fecha — para o gate
// buscar na hora a pendência que ficou esperando. Fora do painel do dono (sem Henry) é sempre `false`.
export function useHenryFullscreen({ onClose } = {}) {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (henryJustClosed(wasOpenRef.current, open)) onCloseRef.current?.();
    wasOpenRef.current = open;
  }, [open]);
  return open;
}
