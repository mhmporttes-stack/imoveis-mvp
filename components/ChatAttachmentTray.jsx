"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { MAX_CHAT_ATTACHMENTS, appendAttachments, moveAttachment, removeAttachment } from "@/lib/chat-attachments-core.mjs";

// Fila de anexos do Chat do WhatsApp e do Chat do Marketplace (dono, 2026-10-23: vários arquivos na mesma mensagem).
// Regras puras em lib/chat-attachments-core.mjs; aqui só o estado da tela e a fila visual (miniaturas em ordem, remover,
// subir/descer, legenda opcional, situação de cada arquivo e "Tentar de novo" só no que falhou).

// Reduz fotos (máx. 1600 px, JPEG) para caber no limite de envio e no do WhatsApp.
export async function prepareImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Não foi possível preparar a imagem.");
  return new File([blob], (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

let sequence = 0;
const newId = () => `att-${Date.now()}-${(sequence += 1)}`;
const revoke = (item) => { if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl); };

// prepare(file) → { file, kind, previewUrl?, ...extras } ou lança com o motivo (tipo/tamanho).
export function useChatAttachments({ prepare, max = MAX_CHAT_ATTACHMENTS }) {
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach(revoke), []);

  // Devolve o aviso (vazio = tudo entrou). Nunca substitui o que já estava na fila.
  const add = useCallback(async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return "";
    const room = Math.max(0, max - itemsRef.current.length);
    const errors = [];
    const prepared = [];
    for (const file of files.slice(0, room)) {
      try {
        prepared.push({ id: newId(), caption: "", status: "pending", error: "", previewUrl: "", ...(await prepare(file)) });
      } catch (prepareError) {
        errors.push(`${file.name || "Arquivo"}: ${prepareError.message}`);
      }
    }
    // Fila lida na hora de gravar (a preparação das fotos é assíncrona): o excedente é recusado, nunca troca.
    const result = appendAttachments(itemsRef.current, prepared, max);
    prepared.slice(prepared.length - result.rejected).forEach(revoke);
    itemsRef.current = result.items;
    setItems(result.items);
    const rejected = files.length - Math.min(files.length, room) + result.rejected;
    if (rejected > 0) errors.push(`Limite de ${max} arquivos por envio — ${rejected} ficou(aram) de fora.`);
    return errors.join(" ");
  }, [max, prepare]);

  const commit = useCallback((next) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const update = useCallback((id, patch) => commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item))), [commit]);
  const remove = useCallback((id) => {
    revoke(itemsRef.current.find((item) => item.id === id));
    commit(removeAttachment(itemsRef.current, id));
  }, [commit]);
  const move = useCallback((id, delta) => commit(moveAttachment(itemsRef.current, id, delta)), [commit]);
  const clear = useCallback(() => {
    itemsRef.current.forEach(revoke);
    commit([]);
  }, [commit]);
  return { items, itemsRef, add, update, remove, move, clear };
}

// Arquivos soltos ou colados (Ctrl+V de imagem) → só os arquivos.
export function filesFromTransfer(transfer) {
  return [...(transfer?.files || [])].filter((file) => file && file.size >= 0);
}

export default function ChatAttachmentTray({ attachments, disabled = false, onRetry, hint = "", renderExtra = null, showCaption = true }) {
  const { items, update, remove, move } = attachments;
  if (!items.length) return null;
  return (
    <div className="mb-2 rounded-2xl border border-line bg-mist/60 p-2" data-attachment-tray="">
      <p className="mb-1.5 px-1 text-[11px] font-bold text-muted">
        {items.length} {items.length === 1 ? "arquivo" : "arquivos"} · saem nesta ordem{hint ? ` · ${hint}` : ""}
      </p>
      <ol className="max-h-[38dvh] space-y-1.5 overflow-y-auto overscroll-contain">
        {items.map((item, index) => (
          <li key={item.id} className={`rounded-xl bg-white p-1.5 ${item.status === "failed" ? "ring-1 ring-red-300" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center text-[11px] font-black text-muted">{index + 1}</span>
              {item.kind === "video" && item.previewUrl ? <video src={item.previewUrl} muted playsInline className="h-12 w-12 shrink-0 rounded-lg bg-black object-cover" />
                : item.previewUrl ? <img src={item.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-mist text-brand"><FileText className="h-5 w-5" /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-navy">{item.file.name}</span>
                <span className="block text-[11px] font-bold text-muted">
                  {formatSize(item.file.size)}
                  {item.status === "sending" ? <> · <Loader2 className="inline h-3 w-3 animate-spin" /> enviando</> : null}
                  {item.status === "failed" ? <span className="text-red-700"> · não enviado</span> : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center">
                <button type="button" onClick={() => move(item.id, -1)} disabled={disabled || index === 0} aria-label={`Subir ${item.file.name}`} className="grid h-9 w-8 place-items-center rounded-full text-slate-500 hover:bg-mist disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(item.id, 1)} disabled={disabled || index === items.length - 1} aria-label={`Descer ${item.file.name}`} className="grid h-9 w-8 place-items-center rounded-full text-slate-500 hover:bg-mist disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(item.id)} disabled={disabled} aria-label={`Remover ${item.file.name}`} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-mist disabled:opacity-30"><X className="h-4 w-4" /></button>
              </span>
            </div>
            {item.status === "failed" ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
                <span className="min-w-0 flex-1 text-[11px] font-bold text-red-700">{item.error}</span>
                {onRetry ? <button type="button" onClick={onRetry} disabled={disabled} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-red-200 bg-white px-3 text-xs font-extrabold text-red-700 hover:border-red-400 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />Tentar de novo</button> : null}
              </div>
            ) : null}
            {renderExtra ? renderExtra(item) : null}
            {showCaption && item.acceptsCaption !== false ? (
              <input type="text" value={item.caption} disabled={disabled} maxLength={1000} onChange={(event) => update(item.id, { caption: event.target.value })}
                placeholder="Legenda deste arquivo (opcional)" aria-label={`Legenda de ${item.file.name}`}
                className="mt-1 h-9 w-full rounded-lg border border-line bg-white px-2 text-base text-navy outline-none placeholder:text-muted focus:border-brand sm:text-sm" />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
