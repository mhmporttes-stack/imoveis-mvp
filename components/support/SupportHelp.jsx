"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleHelp, ImagePlus, X } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Field, { inputClasses } from "@/components/ui/Field";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { prepareImageFile } from "@/components/ChatAttachmentTray";
import { useHenryFullscreen } from "@/components/henry/useHenryFullscreen";
import { helpBottomOffset, isHelpButtonHidden, markHelpLabelSeen, shouldShowHelpLabel } from "@/components/support/help-button-core.mjs";
import { createErrorBuffer, describeRejection, describeWindowError } from "@/components/support/support-error-buffer.mjs";
import {
  TICKET_DESCRIPTION_MAX,
  TICKET_IMAGE_MAX_BYTES,
  TICKET_MAX_IMAGES,
  TICKET_STATUS_LABELS,
  addTicketImages,
  formatSupportTime
} from "@/lib/support-tickets-core.mjs";

// Ajuda e chamados (dono, 2026-11-13). Botão "?" no canto inferior ESQUERDO (mesma posição do Henry), todos os perfis do painel.
// Toque abre a gaveta: "O que está acontecendo?" + prints (galeria, câmera, colar; 1 a 3) + Enviar. O CRM junta usuário, tela,
// aparelho, horário e os últimos erros de JS (buffer em memória abaixo). "Meus chamados" mostra status e a resposta.
// Regras puras: lib/support-tickets-core.mjs e components/support/*-core.mjs. Sem IA, sem serviço externo.

const errorBuffer = createErrorBuffer(5);
let captureInstalled = false;

function installErrorCapture() {
  if (captureInstalled || typeof window === "undefined") return;
  captureInstalled = true;
  window.addEventListener("error", (event) => errorBuffer.push("error", describeWindowError(event)));
  window.addEventListener("unhandledrejection", (event) => errorBuffer.push("promise", describeRejection(event)));
}

const STATUS_TONE = { open: "warning", answered: "success", closed: "neutral" };
let imageSequence = 0;

function readEnvironment() {
  const root = document.documentElement;
  const active = document.activeElement;
  const typing = active instanceof HTMLElement && (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "SELECT"
    || (active.tagName === "INPUT" && !["button", "checkbox", "radio", "submit", "reset", "range", "file", "color"].includes(active.type)));
  return { typing, chatAppMode: root.classList.contains("chat-app-mode"), overlayOpen: root.classList.contains("ui-sheet-open"), viewportWidth: window.innerWidth };
}

export default function SupportHelp({ stackAboveHenry = false, showQueueLink = false }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("new");
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState({ loading: false, error: "", tickets: null });
  const [label, setLabel] = useState(false);
  const [env, setEnv] = useState({ typing: false, chatAppMode: false, overlayOpen: false, viewportWidth: 1280 });
  const henryOpen = useHenryFullscreen();
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    installErrorCapture();
    try {
      setLabel(shouldShowHelpLabel(window.localStorage));
    } catch {
      setLabel(true);
    }
  }, []);

  // Estado do ambiente (teclado, Chat em modo aplicativo, gavetas): reavaliado ao focar/desfocar, redimensionar e quando a classe do <html> muda.
  useEffect(() => {
    const sync = () => setEnv(readEnvironment());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  useEffect(() => () => imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const loadMine = useCallback(async () => {
    setMine((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch("/api/admin/support/tickets", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não consegui carregar seus chamados.");
      setMine({ loading: false, error: "", tickets: data.tickets || [] });
    } catch (loadError) {
      setMine({ loading: false, error: loadError.message || "Não consegui carregar seus chamados.", tickets: null });
    }
  }, []);

  const openHelp = useCallback((nextTab = "new") => {
    setTab(nextTab);
    setSent(false);
    setError("");
    setOpen(true);
    if (label) {
      setLabel(false);
      try { markHelpLabelSeen(window.localStorage); } catch { /* sem armazenamento */ }
    }
  }, [label]);

  // Aviso de resposta do sino leva a "?ajuda=meus": abre direto em "Meus chamados" e limpa o parâmetro da barra.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("ajuda") !== "meus") return;
      url.searchParams.delete("ajuda");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      openHelp("mine");
    } catch {
      // sem URL/histórico: o botão continua funcionando
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open && tab === "mine") loadMine();
  }, [open, tab, loadMine]);

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((file) => file?.type?.startsWith("image/"));
    if (!files.length) return;
    setError("");
    const { items: accepted, rejected } = addTicketImages(imagesRef.current, files);
    const incoming = accepted.slice(imagesRef.current.length);
    const prepared = [];
    let failure = rejected ? `Só cabem ${TICKET_MAX_IMAGES} imagens.` : "";
    for (const file of incoming) {
      try {
        const reduced = await prepareImageFile(file); // mesmo padrão do Chat: 1600 px, JPEG
        if (reduced.size > TICKET_IMAGE_MAX_BYTES) {
          failure = "Uma imagem ficou grande demais. Tente um print menor.";
          continue;
        }
        prepared.push({ id: `help-${Date.now()}-${(imageSequence += 1)}`, file: reduced, previewUrl: URL.createObjectURL(reduced) });
      } catch {
        failure = "Não consegui preparar uma das imagens.";
      }
    }
    if (prepared.length) setImages((current) => addTicketImages(current, prepared).items);
    if (failure) setError(failure);
  }

  function removeImage(id) {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function handlePaste(event) {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("description", text);
      form.set("context", JSON.stringify({
        pathname: window.location.pathname,
        title: document.title,
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        errors: errorBuffer.list()
      }));
      for (const item of images) form.append("images", item.file, item.file.name);
      const response = await fetch("/api/admin/support/tickets", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não consegui enviar agora.");
      images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setImages([]);
      setText("");
      setSent(true);
      setMine({ loading: false, error: "", tickets: null });
    } catch (submitError) {
      setError(submitError.message || "Não consegui enviar agora.");
    } finally {
      setBusy(false);
    }
  }

  const hidden = isHelpButtonHidden({ ...env, overlayOpen: env.overlayOpen || henryOpen, helpOpen: open });

  return (
    <>
      {hidden ? null : (
        <button
          type="button"
          onClick={() => openHelp("new")}
          aria-label="Ajuda"
          className="fixed left-3 z-[34] flex items-center gap-2 rounded-full border border-line bg-white/95 text-navy shadow-float backdrop-blur transition-transform duration-150 ease-out-ui active:scale-[0.97] max-md:bottom-[var(--help-bottom)] md:bottom-4 md:left-[calc(var(--mm-shell-sidebar,76px)+1rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          style={{ "--help-bottom": helpBottomOffset(stackAboveHenry) }}
          data-no-pull
        >
          <span className="relative flex h-10 w-10 items-center justify-center before:absolute before:-inset-0.5 before:content-['']">
            <CircleHelp className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </span>
          {label ? <span className="pr-3 text-[13px] font-semibold">Ajuda</span> : null}
        </button>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Ajuda"
        description="Conte o que está acontecendo. O CRM junta sozinho a tela, o aparelho e o horário."
        side="auto"
        footer={tab === "new" && !sent ? (
          <Button block loading={busy} disabled={text.trim().length < 5} onClick={submit}>Enviar</Button>
        ) : null}
      >
        <div className="space-y-4" onPaste={handlePaste}>
          <Tabs label="Ajuda" value={tab} onChange={(value) => { setTab(value); setSent(false); }} options={[{ value: "new", label: "Novo chamado" }, { value: "mine", label: "Meus chamados" }]} />
          {tab === "new" ? (
            sent ? (
              <EmptyState icon={CircleHelp} title="Chamado enviado" description="Recebemos. Quando houver resposta, você é avisado aqui no CRM." action={<Button variant="secondary" onClick={() => setTab("mine")}>Ver meus chamados</Button>} />
            ) : (
              <>
                <Field label="O que está acontecendo?" required hint={`${text.length}/${TICKET_DESCRIPTION_MAX}`} error={error && !images.length ? error : ""}>
                  <textarea
                    className={`${inputClasses} min-h-[120px] py-2`}
                    value={text}
                    maxLength={TICKET_DESCRIPTION_MAX}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Ex.: ao tocar em Salvar, a tela fica carregando e não salva."
                  />
                </Field>
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">Print da tela <span className="font-normal text-muted">(opcional, até {TICKET_MAX_IMAGES})</span></p>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-control border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-accent-soft">
                      <ImagePlus className="h-4 w-4" aria-hidden="true" /> Galeria
                      <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
                    </label>
                    <label className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-control border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-accent-soft">
                      <Camera className="h-4 w-4" aria-hidden="true" /> Câmera
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-muted">Também dá para colar um print aqui (Ctrl+V). O print pode mostrar dados de clientes: só o dono vê.</p>
                  {images.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {images.map((item) => (
                        <li key={item.id} className="relative h-20 w-20 overflow-hidden rounded-control border border-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.previewUrl} alt="Print anexado" className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removeImage(item.id)} aria-label="Remover imagem" className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-navy/80 text-white">
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {error && images.length ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
                </div>
              </>
            )
          ) : mine.loading && !mine.tickets ? (
            <p className="text-sm text-muted">Carregando…</p>
          ) : mine.error ? (
            <EmptyState tone="danger" title="Não consegui carregar" description={mine.error} action={<Button variant="secondary" onClick={loadMine}>Tentar de novo</Button>} />
          ) : !mine.tickets?.length ? (
            <EmptyState icon={CircleHelp} title="Nenhum chamado ainda" description="Quando você enviar um chamado, ele aparece aqui com a resposta." />
          ) : (
            <ul className="space-y-3">
              {mine.tickets.map((ticket) => (
                <li key={ticket.id} className="rounded-card border border-line bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={STATUS_TONE[ticket.status] || "neutral"}>{TICKET_STATUS_LABELS[ticket.status] || ticket.status}</Badge>
                    <span className="text-xs text-muted">{formatSupportTime(ticket.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{ticket.description}</p>
                  {ticket.reply_text ? (
                    <div className="mt-2 rounded-control bg-accent-soft p-2.5">
                      <p className="text-xs font-semibold text-navy">Resposta{ticket.replied_at ? ` · ${formatSupportTime(ticket.replied_at)}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{ticket.reply_text}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {showQueueLink ? (
            <Link href="/admin/ajuda" className="block text-center text-sm font-bold text-brand hover:text-navy" onClick={() => setOpen(false)}>Ver chamados recebidos</Link>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
