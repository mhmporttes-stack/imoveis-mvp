"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronRight, MessageCircle, UserPlus } from "lucide-react";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";
import { subscribeClientPopups } from "@/components/client-popups/client-popup-bus";
import {
  CLIENT_POPUP_KIND,
  CLIENT_POPUP_LABEL,
  addClientPopupSeen,
  clientPopupAge,
  clientPopupDetail,
  clientPopupStorageKey,
  mergeClientPopups,
  parseClientPopupSeen,
  serializeClientPopupSeen,
  visibleClientPopups
} from "@/lib/client-popup-view-core.mjs";
import styles from "./ClientPopupStack.module.css";

// Janelinha de CLIENTE NOVO (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, CLI-16). Complemento do som e do push (que não
// mudam): cliente novo, transferido ou do Messenger que chegou para quem está vendo aparece no lado direito (no celular, uma
// faixa no topo). Fica até um clique: EM CIMA abre o destino (ficha, Chat ou conversa do Marketplace); em QUALQUER outro
// lugar fecha todas as visíveis (Esc também). Fechada não volta, nem ao recarregar ("visto" guardado neste aparelho).
// Até 3 empilhadas (mais nova em cima) + "+N". Com a tela cheia do Henry aberta não aparece: espera na fila e aparece quando
// ela fechar (sinal único useHenryFullscreen, regra do dono de 2026-10-23). Dados: o ciclo do NewClientSoundListener
// (client-popup-bus), só com a página visível; escopo e regras no servidor (lib/client-popups.js).

const AGE_TICK_MS = 30 * 1000;
const MORE_HREF = "/admin/simulacoes?needsFirstContact=1";

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

// "Visto" no localStorage deste aparelho (não existe "visto" de janelinha no servidor: o "lido" de crm_notifications é o do
// sino, e marcá-lo num clique qualquer apagaria o aviso do sino). Falha do armazenamento (modo privado, cota) só faz a
// janelinha poder voltar ao recarregar — avisa no console, não esconde nada.
function readSeen(userId) {
  try {
    return parseClientPopupSeen(window.localStorage.getItem(clientPopupStorageKey(userId)));
  } catch (error) {
    console.warn("Janelinha de cliente novo: não foi possível ler o que já foi visto.", error);
    return new Map();
  }
}

function writeSeen(userId, seen) {
  try {
    window.localStorage.setItem(clientPopupStorageKey(userId), serializeClientPopupSeen(seen));
  } catch (error) {
    console.warn("Janelinha de cliente novo: não foi possível guardar o que já foi visto.", error);
  }
}

export default function ClientPopupStack({ userId }) {
  const router = useRouter();
  const henryOpen = useHenryFullscreen();
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef(new Map());
  const stackRef = useRef(null);

  const markSeen = useCallback((keys) => {
    if (!keys.length) return;
    seenRef.current = addClientPopupSeen(readSeen(userId), keys);
    writeSeen(userId, seenRef.current);
    const done = new Set(keys);
    setItems((current) => current.filter((item) => !done.has(item.key)));
  }, [userId]);

  useEffect(() => {
    seenRef.current = readSeen(userId);
    const unsubscribe = subscribeClientPopups((incoming) => {
      seenRef.current = readSeen(userId);
      setNow(Date.now());
      setItems((current) => mergeClientPopups(current, incoming, new Set(seenRef.current.keys())));
    });
    // Fechada em outra aba: some aqui também.
    const onStorage = (event) => {
      if (event.key !== clientPopupStorageKey(userId)) return;
      seenRef.current = readSeen(userId);
      setItems((current) => current.filter((item) => !seenRef.current.has(item.key)));
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  const { visible, extra } = visibleClientPopups(items, { henryOpen });

  // "há X min" atualiza enquanto há janelinha na tela.
  useEffect(() => {
    if (!visible.length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [visible.length]);

  // Clique fora (ou Esc) fecha TODAS as visíveis. O clique segue normalmente para o que estava embaixo.
  const visibleKeys = visible.map((item) => item.key).join("|");
  useEffect(() => {
    if (!visibleKeys) return undefined;
    const keys = visibleKeys.split("|");
    const onClick = (event) => {
      if (stackRef.current?.contains(event.target)) return;
      markSeen(keys);
    };
    const onKey = (event) => {
      if (event.key === "Escape") markSeen(keys);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [visibleKeys, markSeen]);

  const open = useCallback((item) => {
    markSeen([item.key]);
    router.push(item.href);
  }, [markSeen, router]);

  const openMore = useCallback(() => {
    markSeen(items.map((item) => item.key));
    router.push(MORE_HREF);
  }, [items, markSeen, router]);

  if (!visible.length) return null;
  return <ClientPopupStackView ref={stackRef} items={visible} extra={extra} isMobile={isMobile} now={now} onOpen={open} onMore={openMore} />;
}

const KIND_ICON = { [CLIENT_POPUP_KIND.NEW]: UserPlus, [CLIENT_POPUP_KIND.TRANSFER]: ArrowLeftRight, [CLIENT_POPUP_KIND.MESSENGER]: MessageCircle };
// Tons semânticos do painel (claro/escuro pelos tokens): novo = info, transferido = alerta, Messenger = acento da marca.
const KIND_ICON_TONE = { [CLIENT_POPUP_KIND.NEW]: "bg-info-soft text-info", [CLIENT_POPUP_KIND.TRANSFER]: "bg-warning-soft text-warning", [CLIENT_POPUP_KIND.MESSENGER]: "bg-brand text-white" };
const KIND_TEXT_TONE = { [CLIENT_POPUP_KIND.NEW]: "text-info", [CLIENT_POPUP_KIND.TRANSFER]: "text-warning", [CLIENT_POPUP_KIND.MESSENGER]: "text-brand" };

// Só apresentação (usada também pela vitrine). items = já no formato do servidor; o mais novo primeiro.
export function ClientPopupStackView({ ref, items = [], extra = 0, isMobile = false, now = Date.now(), onOpen, onMore }) {
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      data-client-popup-stack="true"
      className={isMobile
        ? "fixed inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-[65] flex flex-col gap-1.5"
        : "fixed right-6 top-20 z-[65] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2"}
    >
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] || UserPlus;
        const label = CLIENT_POPUP_LABEL[item.kind] || CLIENT_POPUP_LABEL.new;
        const detail = clientPopupDetail(item);
        const age = clientPopupAge(item.at, now);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onOpen?.(item)}
            aria-label={`${label}: ${item.clientName}${detail ? ` — ${detail}` : ""}${age ? `, ${age}` : ""}. Abrir.`}
            className={`${styles.card} ${isMobile ? styles.enterTop : styles.enterRight} group flex w-full items-center gap-3 rounded-card border border-line bg-white text-left shadow-float outline-none transition-transform duration-150 ease-out-ui focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98] ${isMobile ? "min-h-touch px-3 py-2" : "px-3.5 py-3"}`}
          >
            <span className={`${KIND_ICON_TONE[item.kind] || KIND_ICON_TONE.new} grid shrink-0 place-items-center rounded-full ${isMobile ? "size-8" : "size-9"}`} aria-hidden="true">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`${KIND_TEXT_TONE[item.kind] || KIND_TEXT_TONE.new} text-2xs font-bold uppercase tracking-wide`}>{label}</span>
                {age ? <span className="text-xs tabular-nums text-muted">{age}</span> : null}
              </span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-navy">{item.clientName}</span>
              {detail ? <span className={`block truncate text-[13px] text-muted ${isMobile ? "hidden min-[380px]:block" : ""}`}>{detail}</span> : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 ease-out-ui group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        );
      })}
      {extra > 0 ? (
        <button
          type="button"
          onClick={() => onMore?.()}
          className={`${styles.card} ${isMobile ? styles.enterTop : styles.enterRight} self-end rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-navy shadow-float outline-none focus-visible:ring-2 focus-visible:ring-brand`}
        >
          +{extra} {extra === 1 ? "cliente novo" : "clientes novos"}
        </button>
      ) : null}
    </div>
  );
}
