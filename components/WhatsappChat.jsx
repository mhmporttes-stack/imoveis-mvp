"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  BookOpen,
  Camera,
  Check,
  CheckCheck,
  CircleCheck,
  Clock,
  Download,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Film,
  Info,
  LayoutList,
  Link2,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Megaphone,
  MessageSquareText,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Reply,
  RotateCcw,
  Sparkles,
  Sticker,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Video,
  X,
  Zap
} from "lucide-react";
import Avatar from "@/components/Avatar";
import ChatAudioPlayer from "@/components/ChatAudioPlayer";
import AttendanceGuidePanel from "@/components/guide/AttendanceGuidePanel";
import WhatsappChatBrokers from "@/components/WhatsappChatBrokers";
import WhatsappChatCampaigns from "@/components/WhatsappChatCampaigns";
import WhatsappChatOverview from "@/components/WhatsappChatOverview";
import WhatsappChatShortcuts from "@/components/WhatsappChatShortcuts";
import { audioRecordingSupported, useAudioRecorder } from "@/components/useAudioRecorder";
import ClientDocumentsModal from "@/components/ClientDocumentsModal";
import { CONTACT_WARNING_EVENT, contactWarningMessage, takeContactNotSavedWarning } from "@/lib/whatsapp-contact-warning.mjs";
import { BrokerChip, ClientStatusBadge, ClientStatusDot, WaitingBadge } from "@/components/WhatsappChatBadges";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import { EmojiPicker, MessageActionsMenu, useMessageActionTrigger } from "@/components/WhatsappMessageActions";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";
import { CLIENT_STATUS_OPTIONS } from "@/lib/client-status";
import { chatDocumentProgress } from "@/lib/chat-document-progress.mjs";
import { parseWhatsappText, stripWhatsappFormatting } from "@/lib/whatsapp-format.mjs";
import { OFFICIAL_WHATSAPP_DIGITS } from "@/lib/official-whatsapp.mjs";

const STATUS_OPTIONS = CLIENT_STATUS_OPTIONS.filter((option) => option.value !== "all");

// Filtros da lista — para acrescentar outro no futuro basta uma linha aqui
// (e o filtro correspondente em lib/whatsapp-chat.js).
// Pedido do dono (2026-10-09): sem os filtros "Número 1"/"Número 2"; "Corretores" = conversas dos WhatsApp pessoais
// (filtro "personal" do servidor, mesmo escopo de sempre). Os filtros slot1/slot2 continuam aceitos pelo servidor.
const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "personal", label: "Corretores" },
  { key: "official", label: "Oficial" },
  { key: "unread", label: "Não lidas" },
  // "Aguardando nós" (2026-10-10): última mensagem do cliente — esperando a nossa resposta.
  { key: "waiting_us", label: "Aguardando nós" },
  { key: "awaiting", label: "Sem resposta" },
  { key: "in_service", label: "Em atendimento" },
  { key: "silent", label: "Sem retorno" },
  { key: "finished", label: "Arquivadas" },
  // Particular (regra do dono, 2026-10-09): contatos pessoais, separados de clientes arquivados.
  { key: "private", label: "Particular" }
];

const STATUS_LABELS = { open: "Nova", in_service: "Em atendimento", finished: "Finalizada" };

const TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

const MEDIA_LABELS = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  order: "Pedido",
  unsupported: "Mensagem não suportada"
};

// Aparência "como no WhatsApp" (pedido do dono, 2026-10-09) — só apresentação.
// Fundo bege com desenhos de traço bem sutis (SVG próprio, inline, sem asset de terceiros).
const CHAT_WALLPAPER_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'><g fill='none' stroke='#8C7E66' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' opacity='.16'>"
  + "<path d='M22 56 40 40l18 16v20H22Z M34 76V64h12v12'/>"
  + "<circle cx='160' cy='32' r='8'/><path d='M168 32h24m-8 0v8m6-8v6'/>"
  + "<path d='M98 104h36a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8h-22l-10 8v-8h-4a8 8 0 0 1-8-8v-16a8 8 0 0 1 8-8Z'/>"
  + "<path d='M214 116c-6-8-18-2-12 8l12 12 12-12c6-10-6-16-12-8Z'/>"
  + "<path d='m44 156 4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1Z'/>"
  + "<rect x='160' y='180' width='22' height='38' rx='4'/><path d='M168 212h6'/>"
  + "<path d='M84 222a10 10 0 0 1 18-6 8 8 0 0 1 14 6 7 7 0 0 1-2 14H86a7 7 0 0 1-2-14Z'/>"
  + "<circle cx='116' cy='44' r='2'/><circle cx='226' cy='70' r='2'/><circle cx='22' cy='116' r='2'/><circle cx='134' cy='170' r='2'/><circle cx='234' cy='236' r='2'/>"
  + "</g></svg>";
const CHAT_WALLPAPER_STYLE = { backgroundColor: "#EFEAE2", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(CHAT_WALLPAPER_SVG)}")`, backgroundSize: "260px 260px" };

// Prévia da lista: o servidor grava "[Imagem]", "[Áudio]"… quando a última mensagem é mídia sem legenda.
// Aqui só troca o rótulo técnico por ícone + texto, como no WhatsApp.
const PREVIEW_KINDS = {
  "[Imagem]": { Icon: Camera, label: "Foto" },
  "[Áudio]": { Icon: Mic, label: "Mensagem de voz" },
  "[Vídeo]": { Icon: Video, label: "Vídeo" },
  "[GIF]": { Icon: Film, label: "GIF" },
  "[Figurinha]": { Icon: Sticker, label: "Figurinha" },
  "[Documento]": { Icon: FileText, label: "Documento" },
  "[Localização]": { Icon: MapPin, label: "Localização" },
  "[Contato]": { Icon: UserRound, label: "Contato" },
  "[Mensagem não suportada]": { Icon: AlertCircle, label: "Mensagem não suportada" },
  "[Mensagem]": { Icon: null, label: "Mensagem" }
};

// Texto da mensagem com links clicáveis (azul sublinhado, como no WhatsApp).
// Texto da mensagem com a formatação do WhatsApp (*negrito*, _itálico_, ~tachado~, ```mono```, `código`, citação e
// listas) e links clicáveis. Regras em lib/whatsapp-format.mjs (pedido do dono, 2026-10-09).
function FormattedNodes({ nodes }) {
  return nodes.map((node, index) => {
    if (node.type === "link") {
      return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="break-all text-[#0B6BAF] underline underline-offset-2 hover:text-[#08508A]" onClick={(event) => event.stopPropagation()}>{node.text}</a>;
    }
    if (node.type === "bold") return <strong key={index} className="font-bold"><FormattedNodes nodes={node.children} /></strong>;
    if (node.type === "italic") return <em key={index} className="italic"><FormattedNodes nodes={node.children} /></em>;
    if (node.type === "strike") return <s key={index}><FormattedNodes nodes={node.children} /></s>;
    if (node.type === "mono") return <span key={index} className="font-mono text-[0.92em]">{node.text}</span>;
    if (node.type === "code") return <code key={index} className="rounded bg-black/[0.06] px-1 py-px font-mono text-[0.88em]">{node.text}</code>;
    return <span key={index}>{node.text}</span>;
  });
}

function MessageText({ text }) {
  const blocks = parseWhatsappText(text);
  return blocks.map((block, index) => {
    const content = <FormattedNodes nodes={block.children} />;
    if (block.type === "quote") return <span key={index} className="my-0.5 block border-l-4 border-black/15 pl-2 text-[#54656F]">{content}</span>;
    if (block.type === "bullet") return <span key={index} className="flex gap-1.5 pl-1"><span aria-hidden="true">•</span><span className="min-w-0 flex-1">{content}</span></span>;
    if (block.type === "numbered") return <span key={index} className="flex gap-1.5 pl-1"><span className="tabular-nums">{block.number}.</span><span className="min-w-0 flex-1">{content}</span></span>;
    // Linha comum: quebra de linha só entre duas linhas comuns (as de bloco já quebram sozinhas).
    const next = blocks[index + 1];
    return <span key={index}>{content}{next && next.type === "line" ? "\n" : ""}</span>;
  });
}

function dayKey(value) {
  return DAY_FORMATTER.format(new Date(value));
}

function formatListTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (dayKey(date) === dayKey(new Date())) return TIME_FORMATTER.format(date);
  if (dayKey(date) === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) return "Ontem";
  return SHORT_DATE_FORMATTER.format(date);
}

function formatDayLabel(value) {
  const key = dayKey(value);
  if (key === dayKey(new Date())) return "Hoje";
  if (key === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) return "Ontem";
  return DATE_FORMATTER.format(new Date(value));
}

function displayName(conversation) {
  return conversation.client?.name || conversation.name || conversation.phone;
}

// Lista do Chat: só o primeiro nome (o nome completo fica no cabeçalho da conversa, no cadastro e no card).
// Telefone ou nome que começa por número/símbolo aparece inteiro.
function listFirstName(conversation) {
  const full = String(displayName(conversation) || "").trim();
  return /^\p{L}/u.test(full) ? full.split(/\s+/)[0] : full;
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return phone || "";
}

// Modo aplicativo (pedido do dono, 2026-10-09): marca <html> e os ancestrais do Chat para o CSS (app/globals.css,
// "Chat em modo aplicativo") fixar a tela na altura da janela — só a lista e as mensagens rolam por dentro.
function useChatAppMode(enabled, ref) {
  useEffect(() => {
    if (!enabled || !ref.current) return undefined;
    const root = document.documentElement;
    const ancestors = [];
    for (let node = ref.current.parentElement; node && node !== document.body; node = node.parentElement) {
      node.classList.add("chat-app-ancestor");
      ancestors.push(node);
    }
    root.classList.add("chat-app-mode");
    window.scrollTo(0, 0);
    return () => {
      root.classList.remove("chat-app-mode");
      ancestors.forEach((node) => node.classList.remove("chat-app-ancestor"));
    };
  }, [enabled, ref]);
}

export default function WhatsappChat({ canManage = false, canEditRules = false, currentUserId = "", initialClientId = "", initialText = "", initialSlot = "", canSeeArchived = false, appMode = false }) {
  const [tab, setTab] = useState("conversations");
  const [openError, setOpenError] = useState("");
  // Aviso discreto: o botão WhatsApp do card abriu o Chat, mas o registro do contato falhou.
  const [contactWarning, setContactWarning] = useState("");
  useEffect(() => {
    const check = () => {
      const pending = takeContactNotSavedWarning();
      if (pending) setContactWarning(contactWarningMessage(pending.name));
    };
    check();
    window.addEventListener(CONTACT_WARNING_EVENT, check);
    return () => window.removeEventListener(CONTACT_WARNING_EVENT, check);
  }, []);
  const [brokers, setBrokers] = useState([]);
  // Números do PRÓPRIO usuário (apelido e status) — rótulo dos filtros e "Abrir no outro número".
  const [mySlots, setMySlots] = useState([]);
  const [filter, setFilter] = useState("all");
  // Filtro pela ETAPA do cliente (pedido do dono 2026-10-06), aplicado no servidor; "" = todas.
  const [clientStatus, setClientStatus] = useState("");
  const clientStatusRef = useRef(clientStatus);
  clientStatusRef.current = clientStatus;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  // Guia de Atendimento ao lado do Chat: no computador abre junto (e lembra se o corretor fechou); no celular o Chat
  // continua principal e o Guia abre por cima quando o corretor toca em "Guia de Atendimento".
  const [isDesktop, setIsDesktop] = useState(true);
  const [guideDesktop, setGuideDesktop] = useState(true);
  const [guideMobile, setGuideMobile] = useState(false);
  const [insertRequest, setInsertRequest] = useState(null); // { conversationId, text, nonce }
  // Aba "Corretores": ver o Chat filtrado por um corretor específico — o
  // MESMO componente/estado, só um escopo extra na consulta (nunca um Chat
  // paralelo). null = visão normal (tudo dentro da permissão de quem está logado).
  const [scopedBroker, setScopedBroker] = useState(null); // { id, name } | null

  const sectionRef = useRef(null);
  useChatAppMode(appMode, sectionRef);
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  const selectedRef = useRef(selectedId);
  const scopedBrokerRef = useRef(null);
  const readAttemptRef = useRef({});
  filterRef.current = filter;
  searchRef.current = search;
  selectedRef.current = selectedId;
  scopedBrokerRef.current = scopedBroker;

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    try {
      if (window.localStorage.getItem("wa-chat-guide-open") === "0") setGuideDesktop(false);
    } catch {
      // sem armazenamento local: fica no padrão (aberto)
    }
    return () => query.removeEventListener("change", sync);
  }, []);

  const guideOpen = isDesktop ? guideDesktop : guideMobile;
  // "Inserir no chat": o texto vai para o campo da conversa ABERTA (marcado com o id dela — nunca para outra).
  const insertIntoComposer = useCallback((text) => {
    if (!selectedRef.current) return;
    setInsertRequest({ conversationId: selectedRef.current, text, nonce: Date.now() });
    setGuideMobile(false);
  }, []);
  const setGuideOpen = useCallback((open) => {
    if (isDesktop) {
      setGuideDesktop(open);
      try { window.localStorage.setItem("wa-chat-guide-open", open ? "1" : "0"); } catch { /* opcional */ }
    } else {
      setGuideMobile(open);
    }
  }, [isDesktop]);

  const loadList = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setListLoading(true);
    try {
      const params = new URLSearchParams({ filter: filterRef.current });
      if (searchRef.current) params.set("q", searchRef.current);
      if (clientStatusRef.current) params.set("clientStatus", clientStatusRef.current);
      if (scopedBrokerRef.current) params.set("brokerId", scopedBrokerRef.current.id);
      const response = await fetch(`/api/admin/whatsapp-chat/conversations?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as conversas.");
      setConversations(data.conversations || []);
      setListError("");
    } catch (error) {
      setListError(error.message);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível abrir a conversa.");
      if (selectedRef.current !== id) return;
      // Cliente arquivado para quem não é o dono (WA-13): Chat em branco, como se não houvesse conversa.
      if (data.empty) {
        setSelectedId("");
        selectedRef.current = "";
        setDetail(null);
        setDetailError("");
        return;
      }
      setDetail(data);
      setDetailError("");
      // Abrir a conversa lê as mensagens internas (o servidor marca): a bolinha azul da lista some na hora.
      setConversations((current) => (current.some((item) => item.id === id && item.internalUnread > 0) ? current.map((item) => (item.id === id ? { ...item, internalUnread: 0 } : item)) : current));
      // O servidor decide se a abertura conta como leitura (administrador/gestor só supervisionando
      // uma conversa que não é dele NÃO a marca como lida). Uma tentativa por conversa/contagem.
      const unread = data.conversation.unreadCount;
      if (unread > 0 && document.visibilityState === "visible" && readAttemptRef.current[id] !== unread) {
        readAttemptRef.current[id] = unread;
        fetch(`/api/admin/whatsapp-chat/conversations/${id}/read`, { method: "POST" })
          .then((res) => res.json().catch(() => ({})))
          .then((result) => {
            if (result?.marked === false) return;
            setConversations((current) => current.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)));
          })
          .catch(() => {});
      }
    } catch (error) {
      if (!silent) setDetailError(error.message);
    }
  }, []);

  // Tempo real: um ping do servidor (ou o polling de segurança) refaz a lista
  // e a conversa aberta.
  const { summary, refresh: refreshSummary } = useWhatsappChatSummary(
    useCallback(() => {
      loadList({ silent: true });
      if (selectedRef.current) loadDetail(selectedRef.current, { silent: true });
    }, [loadList, loadDetail])
  );

  useEffect(() => {
    loadList();
  }, [filter, search, scopedBroker, clientStatus, loadList]);

  useEffect(() => {
    fetch("/api/admin/whatsapp-individual/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setMySlots(Array.isArray(payload?.slots) ? payload.slots : []))
      .catch(() => {});
  }, []);

  // Abre a conversa deste cliente em outro número do responsável (o próprio usuário escolhe; padrão = Número 1).
  const openClientInSlot = useCallback(async (clientId, slot) => {
    const response = await fetch("/api/admin/whatsapp-chat/open-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, slot })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível abrir a conversa neste número.");
    await loadList({ silent: true });
    if (data.conversationId) openConversation(data.conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList]);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/admin/whatsapp-chat/brokers", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setBrokers(payload.brokers || []))
      .catch(() => {});
  }, [canManage]);

  // Vindo do botão "WhatsApp" de um cliente (?client=): abre/cria a conversa
  // dele no número oficial e já seleciona.
  useEffect(() => {
    if (!initialClientId) return;
    let cancelled = false;
    fetch("/api/admin/whatsapp-chat/open-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // initialSlot (?slot=): abre a conversa no WhatsApp PESSOAL do corretor (Número 1/2), ex.: "Enviar simulação" com a janela do oficial fechada.
      body: JSON.stringify(initialSlot ? { clientId: initialClientId, slot: initialSlot } : { clientId: initialClientId })
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Não foi possível abrir a conversa deste cliente.");
        if (cancelled) return;
        window.history.replaceState(null, "", window.location.pathname); // /admin/chat ou /chat-app (app da tela inicial)
        setTab("conversations");
        await loadList({ silent: true });
        // Cliente arquivado (WA-13) para quem não é o dono: Chat em branco, nenhuma conversa aberta.
        if (data.conversationId) {
          openConversation(data.conversationId);
          // "Enviar simulação" (2026-10-09): o link da apresentação já entra no campo de mensagem; o corretor só envia.
          if (initialText) setInsertRequest({ conversationId: data.conversationId, text: initialText, nonce: Date.now() });
        }
      })
      .catch((error) => { if (!cancelled) setOpenError(error.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId]);

  function openConversation(id) {
    // Leva o painel para o topo da tela: a conversa e o campo de mensagem
    // ocupam a altura inteira da janela, sem precisar rolar a página.
    sectionRef.current?.scrollIntoView({ block: "start" });
    setSelectedId(id);
    selectedRef.current = id;
    setDetail(null);
    setDetailError("");
    setInfoOpen(false);
    setGuideMobile(false);
    setInsertRequest(null);
    loadDetail(id).then(() => refreshSummary());
  }

  function closeConversation() {
    setInsertRequest(null);
    setSelectedId("");
    selectedRef.current = "";
    setDetail(null);
  }

  const totalUnread = summary.unreadMessages || 0;

  return (
    <section className={`container-page scroll-mt-[72px] ${appMode ? "chat-app-root" : ""}`} ref={sectionRef}>
      {openError ? <p className="mb-3 max-md:mx-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{openError}</p> : null}
      {contactWarning ? (
        <p role="status" className="mb-3 max-md:mx-3 flex items-start justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">
          <span>{contactWarning}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setContactWarning("")}>Fechar</button>
        </p>
      ) : null}
      <div className={appMode
        ? `mb-2 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 md:px-0 [&>button]:shrink-0 [&>button]:!py-1.5 ${selectedId && tab === "conversations" ? "hidden lg:flex" : ""}`
        : "mb-3 flex flex-wrap items-center gap-2"}>
        <button type="button" onClick={() => setTab("conversations")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold transition ${tab === "conversations" ? "bg-navy text-white shadow-soft" : "border border-navy/15 bg-white text-navy hover:border-brand"}`}>
          <MessageCircle className="h-4 w-4" />Conversas
          {totalUnread > 0 ? <span className="rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white">{totalUnread}</span> : null}
        </button>
        <button type="button" onClick={() => setTab("overview")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold transition ${tab === "overview" ? "bg-navy text-white shadow-soft" : "border border-navy/15 bg-white text-navy hover:border-brand"}`}>
          <LayoutList className="h-4 w-4" />Visão geral
          {summary.awaitingLate > 0 ? <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-black leading-5 text-white" title="Conversas sem resposta há mais de 30 min">{summary.awaitingLate}</span> : null}
        </button>
        {canManage ? (
          <button type="button" onClick={() => setTab("campaigns")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold transition ${tab === "campaigns" ? "bg-navy text-white shadow-soft" : "border border-navy/15 bg-white text-navy hover:border-brand"}`}>
            <Megaphone className="h-4 w-4" />Campanhas
          </button>
        ) : null}
        {canManage ? (
          <button type="button" onClick={() => setTab("brokers")} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold transition ${tab === "brokers" ? "bg-navy text-white shadow-soft" : "border border-navy/15 bg-white text-navy hover:border-brand"}`}>
            <Users className="h-4 w-4" />Corretores
          </button>
        ) : null}
        <span className="ml-auto"><WhatsappIndividualStatus align="end" /></span>
      </div>

      {tab === "brokers" && canManage ? (
        <div className={`admin-motion-enter overflow-hidden rounded-[28px] border border-line bg-white shadow-soft ${appMode ? "min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:rounded-none max-md:border-x-0" : ""}`}>
          <WhatsappChatBrokers
            onOpen={(id, name) => {
              setScopedBroker({ id, name });
              setSelectedId("");
              selectedRef.current = "";
              setDetail(null);
              setTab("conversations");
            }}
          />
        </div>
      ) : null}

      {tab === "campaigns" && canManage ? (
        <div className={`admin-motion-enter overflow-hidden rounded-[28px] border border-line bg-white shadow-soft ${appMode ? "min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:rounded-none max-md:border-x-0" : ""}`}>
          <WhatsappChatCampaigns
            onOpenConversation={(id) => {
              setTab("conversations");
              setTimeout(() => openConversation(id), 0);
            }}
          />
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className={`admin-motion-enter overflow-hidden rounded-[28px] border border-line bg-white shadow-soft ${appMode ? "min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:rounded-none max-md:border-x-0" : ""}`}>
          <WhatsappChatOverview
            canManage={canManage}
            onOpen={(id) => {
              setTab("conversations");
              setTimeout(() => openConversation(id), 0);
            }}
          />
        </div>
      ) : null}

      {tab === "conversations" && scopedBroker ? (
        <div className="mb-3 max-md:mx-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-2.5">
          <p className="text-sm font-bold text-navy">WhatsApp de <span className="font-black">{scopedBroker.name}</span></p>
          <button type="button" onClick={() => { setScopedBroker(null); setTab("brokers"); }} className="text-xs font-black text-brand hover:underline">
            ← Corretores
          </button>
        </div>
      ) : null}

      <div className={`overflow-hidden rounded-[28px] border border-line bg-white shadow-soft ${tab === "overview" || tab === "campaigns" || tab === "brokers" ? "hidden" : "admin-motion-enter"} ${appMode ? "flex min-h-0 flex-1 flex-col md:mb-4 max-md:rounded-none max-md:border-x-0 max-md:border-b-0" : ""}`}>
        <div className={`grid grid-cols-1 ${appMode ? "min-h-0 flex-1" : "h-[calc(100dvh-150px)] min-h-[520px]"} ${selectedId && guideOpen && isDesktop ? "lg:grid-cols-[300px_minmax(0,1fr)_390px] xl:grid-cols-[320px_minmax(0,1fr)_420px]" : "lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]"}`}>
          <ConversationList
            className={selectedId ? "hidden lg:flex" : "admin-motion-back flex"}
            conversations={conversations}
            error={listError}
            filter={filter}
            loading={listLoading}
            onFilter={setFilter}
            filterLabels={Object.fromEntries(mySlots.filter((item) => item.label).map((item) => [`slot${item.slot}`, `Número ${item.slot} · ${item.label}`]))}
            clientStatus={clientStatus}
            onClientStatus={setClientStatus}
            canSeeArchived={canSeeArchived}
            onSearch={setSearchInput}
            onSelect={openConversation}
            search={searchInput}
            selectedId={selectedId}
            totalUnread={totalUnread}
            currentUserId={currentUserId}
          />

          <div className={`${selectedId ? "admin-motion-detail flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col border-line lg:border-l`}>
            {selectedId ? (
              <Thread
                canManage={canManage}
                canEditRules={canEditRules}
                currentUserId={currentUserId}
                mySlots={mySlots}
                onOpenClientSlot={openClientInSlot}
                detail={detail}
                error={detailError}
                infoOpen={infoOpen}
                guideOpen={guideOpen}
                insertRequest={insertRequest}
                infoAlways={guideOpen && isDesktop}
                onSetGuideOpen={setGuideOpen}
                onBack={closeConversation}
                onChanged={() => {
                  loadList({ silent: true });
                  loadDetail(selectedId, { silent: true });
                  refreshSummary();
                }}
                onToggleInfo={() => setInfoOpen((open) => !open)}
                onDeleted={() => {
                  closeConversation();
                  loadList({ silent: true });
                  refreshSummary();
                }}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-brand">
                    <MessageCircle className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-lg font-black text-navy">Selecione uma conversa</p>
                  <p className="mt-1 text-sm font-bold text-muted">Tudo que os clientes mandam para o número oficial aparece aqui.</p>
                </div>
              </div>
            )}
          </div>

          {selectedId && guideOpen && isDesktop ? (
            <aside className="flex min-h-0 flex-col overflow-hidden border-l border-line">
              <AttendanceGuidePanel key={selectedId} conversationId={selectedId} className="min-h-0 flex-1" onInsert={insertIntoComposer} canInsert={detail?.conversation?.window?.open !== false} />
            </aside>
          ) : selectedId && detail ? (
            <aside className="hidden min-h-0 overflow-y-auto border-l border-line xl:block">
              <ContactPanel brokers={brokers} canManage={canManage} detail={detail} onChanged={() => { loadList({ silent: true }); loadDetail(selectedId, { silent: true }); }} />
            </aside>
          ) : null}
        </div>
      </div>

      {selectedId && guideOpen && !isDesktop ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-label="Guia de Atendimento">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <button type="button" onClick={() => setGuideOpen(false)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-extrabold text-navy hover:border-brand"><ArrowLeft className="h-4 w-4" />Voltar ao chat</button>
          </div>
          <AttendanceGuidePanel key={selectedId} conversationId={selectedId} className="min-h-0 flex-1" onInsert={insertIntoComposer} canInsert={detail?.conversation?.window?.open !== false} />
        </div>
      ) : null}

      {infoOpen && detail ? (
        <div className={`fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 ${guideOpen && isDesktop ? "" : "xl:hidden"}`} onClick={() => setInfoOpen(false)}>
          <div className="max-h-[80dvh] w-full overflow-y-auto rounded-t-[24px] bg-white shadow-soft" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="font-black text-navy">Informações do contato</p>
              <button type="button" onClick={() => setInfoOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-mist" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ContactPanel brokers={brokers} canManage={canManage} detail={detail} onChanged={() => { loadList({ silent: true }); loadDetail(selectedId, { silent: true }); }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConversationList({ className, conversations, error, filter, filterLabels = {}, loading, onFilter, onSearch, onSelect, search, selectedId, totalUnread, clientStatus = "", onClientStatus = () => {}, canSeeArchived = false, currentUserId = "" }) {
  // "Arquivados" só para a conta do dono (WA-13: conversas de arquivados ficam fora do Chat; ele lê em somente leitura).
  const statusOptions = STATUS_OPTIONS.filter((option) => option.value !== "archived" || canSeeArchived);
  return (
    <div className={`${className} min-h-0 min-w-0 flex-col`}>
      <div className="space-y-2 border-b border-[#E9EDEF] bg-white px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-[#111B21]">Conversas</h2>
          {totalUnread > 0 ? (
            <span className="rounded-full bg-[#25D366] px-2.5 py-0.5 text-xs font-black text-[#0B2A17]">{totalUnread} não lidas</span>
          ) : null}
        </div>
        <label className="relative block">
          <span className="sr-only">Buscar conversa</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#54656F]" aria-hidden="true" />
          <input
            className="h-11 w-full rounded-full border border-transparent bg-[#F0F2F5] pl-10 pr-4 text-sm font-semibold text-[#111B21] outline-none placeholder:text-[#54656F] focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            type="search"
            value={search}
          />
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilter(item.key)}
              aria-pressed={filter === item.key}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                filter === item.key ? "bg-[#D9FDD3] text-[#0A5C30]" : "bg-[#F0F2F5] text-[#54656F] hover:bg-[#E4E7EA] hover:text-[#111B21]"
              }`}
            >
              {filterLabels[item.key] || item.label}
            </button>
          ))}
        </div>
        {/* Particular: conversa pessoal, não cliente — filtro por situação do cliente não se aplica. */}
        <label className={`flex items-center gap-2 text-xs font-extrabold text-navy ${filter === "private" ? "hidden" : ""}`}>
          <span className="shrink-0">Status do cliente</span>
          <select
            className={`h-10 min-w-0 flex-1 rounded-2xl border bg-white px-3 text-sm font-bold outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 ${clientStatus ? "border-brand text-brand" : "border-line text-navy"}`}
            value={clientStatus}
            onChange={(event) => onClientStatus(event.target.value)}
            data-client-status-filter=""
          >
            <option value="">Todos os status</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.filterLabel || option.label}</option>
            ))}
          </select>
        </label>
        {clientStatus === "archived" ? <p className="text-xs font-semibold text-muted">Conversas de clientes arquivados: só você vê, e só para leitura.</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white">
        {error ? <p className="m-4 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {loading && !conversations.length ? (
          <p className="flex items-center justify-center gap-2 p-8 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
        ) : null}
        {!loading && !error && !conversations.length ? (
          <p className="p-8 text-center text-sm font-bold text-muted">
            {search || filter !== "all" || clientStatus ? "Nenhuma conversa neste filtro." : "Nenhuma conversa ainda. Quando alguém escrever para o número oficial, aparece aqui."}
          </p>
        ) : null}
        {conversations.map((conversation) => (
          <ConversationRow key={conversation.id} conversation={conversation} currentUserId={currentUserId} selected={conversation.id === selectedId} onSelect={() => onSelect(conversation.id)} />
        ))}
      </div>
    </div>
  );
}

// Badge (canto do avatar) mostrando qual conta WhatsApp enviou por último
// nesta conversa: foto do corretor (sessão individual) ou o logo oficial.
// Só visual — sem nome/texto ao lado (pedido explícito, pra não poluir a
// lista); tooltip discreto no hover (desktop).
function ConversationAccountBadge({ account, personal = false }) {
  // A sessão manda (2026-10-09): conversa do WhatsApp pessoal de alguém é PESSOAL mesmo quando o canal gravado na
  // conversa ainda é o do número oficial (conversa que veio do oficial e passou para o corretor — caso Agnaldo/Jennyfer).
  // É o mesmo critério do "Enviando por" da caixa de mensagem.
  const official = personal ? false : account ? account.channel === "whatsapp_cloud_api" : true;
  const tooltip = official ? "WhatsApp oficial" : account?.name ? `WhatsApp pessoal: ${account.name}` : "WhatsApp pessoal";
  return (
    <span
      className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm"
      title={tooltip}
    >
      {official ? (
        <svg viewBox="0 0 32 32" aria-hidden="true" className="h-full w-full text-emerald-500" fill="currentColor">
          <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
        </svg>
      ) : (
        <UserRound className="h-3 w-3 text-[#54656F]" aria-label="WhatsApp pessoal" />
      )}
    </span>
  );
}

// Selo pequeno abaixo do nome (como o selo "CORRETOR" do WhatsApp Business).
function ListTag({ tone = "slate", children, title }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-[#E7F8EC] text-[#0B6B3A]",
    amber: "bg-amber-50 text-amber-800",
    broker: "bg-[#FFF1BF] text-[#6B4A00]"
  };
  return <span title={title} className={`inline-flex max-w-[150px] shrink-0 items-center gap-1 truncate whitespace-nowrap rounded-[5px] px-1.5 py-px text-[10px] font-extrabold ${tone === "broker" ? "" : "uppercase tracking-wide"} ${tones[tone] || tones.slate}`}>{children}</span>;
}

// "Vincular a cliente existente" (2026-10-10): busca na lista de Clientes (mesmo escopo do usuário, no servidor) por
// nome, código ou telefone e liga a conversa ao cadastro escolhido.
function LinkExistingClient({ conversationId, initialQuery = "", onLinked }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/simulation-registrations/list?query=${encodeURIComponent(term)}&pageSize=8`);
        const data = await response.json().catch(() => ({}));
        if (!cancelled) setResults(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);

  async function link(clientId) {
    setLinking(clientId);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversationId}/link-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível vincular.");
      onLinked?.();
    } catch (linkError) {
      setError(linkError.message);
    } finally {
      setLinking("");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); setQuery(initialQuery); }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-navy/15 bg-white text-sm font-extrabold text-navy transition hover:border-brand">
        <Link2 className="h-4 w-4" /> Vincular a cliente existente
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-line bg-white p-3">
      <label className="block text-xs font-black text-navy">
        Buscar cliente (nome, código ou telefone)
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand" placeholder="Ex.: Maria ou 99999-0000" />
      </label>
      {loading ? <p className="flex items-center gap-1 text-xs font-bold text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</p> : null}
      {!loading && query.trim().length >= 2 && !results.length ? <p className="text-xs font-bold text-muted">Nenhum cliente encontrado.</p> : null}
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {results.map((item) => (
          <li key={item.id}>
            <button type="button" disabled={Boolean(linking)} onClick={() => link(item.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-mist disabled:opacity-50">
              <span className="min-w-0">
                <span className="block truncate font-extrabold text-navy">{item.name}</span>
                <span className="block truncate text-xs font-bold text-muted">{[item.registration?.clientCode, item.registration?.phone].filter(Boolean).join(" · ")}</span>
              </span>
              {linking === item.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Link2 className="h-4 w-4 shrink-0 text-brand" />}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-extrabold text-muted hover:text-navy">Cancelar</button>
    </div>
  );
}

function ConversationPreview({ conversation, unread }) {
  // Particular (2026-10-10): quem não é o dono recebe a linha sem prévia — só o rótulo.
  if (conversation.private && !conversation.lastMessagePreview) {
    return <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium leading-5 text-[#54656F]"><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Conversa particular</span></span>;
  }
  const preview = stripWhatsappFormatting(conversation.lastMessagePreview || "").replace(/\n+/g, " ");
  const kind = PREVIEW_KINDS[preview.trim()] || null;
  const outbound = conversation.lastMessageDirection === "outbound";
  return (
    <span className={`flex min-w-0 items-center gap-1 text-[13px] leading-5 ${unread ? "font-bold text-[#111B21]" : "font-medium text-[#54656F]"}`}>
      {outbound ? <span className="shrink-0">{conversation.lastOutboundStatus ? <StatusTicks status={conversation.lastOutboundStatus} /> : <Check className="h-4 w-4 text-[#667781]" aria-label="Enviada por nós" />}</span> : null}
      {kind?.Icon ? <kind.Icon className="h-4 w-4 shrink-0 text-[#667781]" aria-hidden="true" /> : null}
      <span className="truncate">{kind ? kind.label : preview || "—"}</span>
    </span>
  );
}

// Aviso de espera em pílula curta (mesmas regras do WaitingBadge): sem resposta (vermelho), aguardando (âmbar), cliente em
// silêncio (cinza). O texto completo fica no tooltip e no leitor de tela.
function WaitingText({ waiting }) {
  if (!waiting) return null;
  if (waiting.kind === "awaiting_us" && waiting.level === "ok") return null;
  const late = waiting.kind === "awaiting_us" && waiting.level === "late";
  const awaiting = waiting.kind === "awaiting_us";
  const tone = late ? "bg-red-50 text-red-700" : awaiting ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600";
  const label = awaiting ? (late ? "sem resposta há" : "aguardando há") : "cliente em silêncio há";
  const full = `${label} ${formatWaitShort(waiting.minutes)}`;
  return (
    <span title={full} aria-label={full} className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-bold leading-4 ${tone}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />{formatWaitShort(waiting.minutes)}
    </span>
  );
}

function formatWaitShort(minutes) {
  const value = Number(minutes) || 0;
  if (value < 60) return `${value} min`;
  if (value < 48 * 60) return `${Math.floor(value / 60)} h`;
  return `${Math.floor(value / 1440)} dias`;
}

function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function ConversationRow({ conversation, currentUserId = "", selected, onSelect }) {
  const unread = conversation.unreadCount > 0;
  const name = displayName(conversation);
  const phone = formatPhone(conversation.phone);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={phone}
      className={`flex w-full items-stretch gap-3 pl-3 text-left transition hover:bg-[#F5F6F6] ${selected ? "bg-[#F0F2F5]" : "bg-white"}`}
    >
      <span className="relative shrink-0 self-center py-2.5">
        <Avatar name={name} photoUrl={conversation.photoUrl} size={52} />
        <ConversationAccountBadge account={conversation.account} personal={Boolean(conversation.sessionUserId)} />
      </span>
      {/* Separador fino só a partir do texto (depois do avatar), como no WhatsApp */}
      <span className="min-w-0 flex-1 border-b border-[#E9EDEF] py-2.5 pr-3">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* Só o nome (a situação do cliente vai para a linha de baixo: nome nunca mais é cortado por ela) */}
            <span title={name} className={`min-w-0 truncate text-[16px] leading-6 text-[#111B21] ${unread ? "font-black" : "font-bold"}`}>{listFirstName(conversation)}</span>
          </span>
          <span className={`shrink-0 text-xs ${unread ? "font-extrabold text-[#0A7D41]" : "font-semibold text-[#54656F]"}`}>{formatListTime(conversation.lastMessageAt)}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <ConversationPreview conversation={conversation} unread={unread} />
          {unread || conversation.internalUnread > 0 ? (
            <span className="flex shrink-0 items-center gap-1">
              {conversation.internalUnread > 0 ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#1D6FE8] px-1.5 text-[11px] font-black text-white" title="Mensagem interna da equipe" aria-label={`${conversation.internalUnread} mensagens internas não lidas`}>{conversation.internalUnread}</span>
              ) : null}
              {unread ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-black text-[#0B2A17]" aria-label={`${conversation.unreadCount} não lidas`}>{conversation.unreadCount}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        {/* Lista limpa (pedido do dono, 2026-10-09, aprovada): uma linha de contexto — situação do cliente, aviso de espera
            (pílula) e corretor pelo PRIMEIRO NOME. O canal fica só no selo do avatar (WhatsApp = oficial, pessoa = pessoal). */}
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-5 text-[#667781]">
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {/* Particular (WA-19, dono 2026-10-09): conversa pessoal, não cliente — sem situação do cliente nem aviso de espera. */}
            {conversation.private ? <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#54656F]"><Lock className="h-3 w-3" aria-hidden="true" />Conversa particular</span>
              : conversation.client ? <ClientStatusDot client={conversation.client} className="min-w-0" /> : <span className="shrink-0 font-semibold text-amber-700">não cadastrado</span>}
          </span>
          {conversation.private ? null : <WaitingText waiting={conversation.waiting} />}
          {conversation.broker && conversation.broker.id !== currentUserId ? (
            <span className="inline-flex max-w-[96px] shrink-0 items-center rounded-full bg-[#EAF2FE] px-2 py-0.5 text-[12px] font-semibold leading-4 text-brand" title={`Corretor: ${conversation.broker.name || "Corretor"}`}><span className="truncate">{firstNameOf(conversation.broker.name) || "Corretor"}</span></span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function Thread({ canManage, canEditRules, currentUserId, mySlots = [], onOpenClientSlot = null, detail, error, guideOpen, insertRequest, infoAlways, infoOpen, onBack, onChanged, onDeleted, onSetGuideOpen, onToggleInfo }) {
  const [assuming, setAssuming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [reactionError, setReactionError] = useState("");
  const [documentSelectionOpen, setDocumentSelectionOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [hasDocumentReports, setHasDocumentReports] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  // "Responder no interno" (pedido do dono, 2026-10-09): cita a mensagem numa nota que só a equipe vê.
  const [internalRequest, setInternalRequest] = useState(0);
  const [editTarget, setEditTarget] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const scrollRef = useRef(null);
  const lastCountRef = useRef(0);
  const conversation = detail?.conversation;
  const messages = detail?.messages || [];
  // Foto/nome do contato para o player de áudio (estilo WhatsApp).
  const audioContact = conversation ? { name: displayName(conversation), photoUrl: conversation.photoUrl || "" } : null;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const byRefId = new Map(messages.filter((message) => message.refId).map((message) => [message.refId, message]));
  const showAssume = Boolean(conversation) && !conversation.privateLocked && !conversation.archivedReadOnly && conversation.assignedUserId !== currentUserId && conversation.status !== "finished";
  // Dois números (2026-10-08): conversa de cliente no MEU WhatsApp pessoal pode ser aberta no meu outro número conectado.
  const otherSlot = conversation?.client?.id && conversation.sessionUserId && conversation.sessionUserId === currentUserId && !conversation.archivedReadOnly
    ? mySlots.find((item) => item.slot !== (conversation.sessionSlot || 1) && item.status === "connected") || null
    : null;

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setReplyTo(null);
    setEditTarget(null);
    setActionTarget(null);
    setReactionError("");
    setDocumentSelectionOpen(false);
    setDocumentsOpen(false);
  }, [conversation?.id]);

  useEffect(() => {
    const clientId = conversation?.client?.id;
    if (!clientId) return undefined;
    let cancelled = false;
    setHasDocumentReports(false);
    fetch(`/api/admin/client-documents/batches?clientId=${encodeURIComponent(clientId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setHasDocumentReports(Boolean(data?.batches?.some((batch) => batch.status === "analyzed"))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [conversation?.client?.id]);

  async function reactTo(message, emoji) {
    setReactionError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/reactions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, emoji })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível reagir.");
      onChanged();
    } catch (failure) {
      setReactionError(failure.message);
    }
  }

  // Editar e apagar para todos: mesma API nos 3 ambientes; a permissão é
  // conferida de novo no servidor.
  async function deleteForEveryone(message) {
    setReactionError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/messages/${message.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível apagar a mensagem.");
      onChanged();
    } catch (failure) {
      setReactionError(failure.message);
    }
  }

  // "Adicionar às notas" (2026-10-09): o texto vira nota interna desta conversa (o cliente não vê).
  async function addToNotes(message) {
    setReactionError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/internal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.body })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a nota.");
      onChanged();
    } catch (failure) {
      setReactionError(failure.message);
    }
  }

  function startReply(message) {
    setEditTarget(null);
    setReplyTo(message);
  }

  function startEdit(message) {
    setReplyTo(null);
    setEditTarget(message);
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Desce ao abrir e a cada mensagem nova.
    if (messages.length !== lastCountRef.current) {
      element.scrollTop = element.scrollHeight;
      lastCountRef.current = messages.length;
    }
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    lastCountRef.current = 0;
  }, [conversation?.id]);

  async function changeStatus(status) {
    await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }).catch(() => {});
    onChanged();
  }

  // "Marcar como resolvida" (2026-10-10): sai de "Aguardando nós", "Sem resposta" e "Sem retorno" sem arquivar.
  async function setResolved(resolved) {
    await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved })
    }).catch(() => {});
    onChanged();
  }

  // Atalho "Arquivar" (pedido do dono, 2026-10-09): para conversa particular que virou cliente, muda o STATUS DO
  // CLIENTE para Arquivado (sai do funil e a conversa sai do Chat, WA-13) e finaliza a conversa. Sem cliente: só finaliza.
  const [archiving, setArchiving] = useState(false);
  async function archiveClient() {
    const clientId = conversation.client?.id;
    if (!clientId) {
      await changeStatus("finished");
      return;
    }
    if (!window.confirm(`Arquivar ${conversation.client?.name || displayName(conversation)}? O cliente vai para "Arquivado" e esta conversa sai do Chat.`)) return;
    setArchiving(true);
    setReactionError("");
    try {
      const response = await fetch(`/api/simulation-registrations/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível arquivar o cliente.");
      await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "finished" })
      }).catch(() => {});
      onChanged();
    } catch (failure) {
      setReactionError(failure.message);
    } finally {
      setArchiving(false);
    }
  }

  async function setPrivate(makePrivate) {
    if (makePrivate && conversation.client?.id && !window.confirm(`Mover ${conversation.client?.name || displayName(conversation)} para Particular? Deixa de ser cliente (sai das listas de Clientes) e a conversa fica só na aba Particular.`)) return;
    setArchiving(true);
    setReactionError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private: makePrivate })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar a conversa.");
      onChanged();
    } catch (failure) {
      setReactionError(failure.message);
    } finally {
      setArchiving(false);
    }
  }

  async function deleteConversation() {
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível excluir a conversa.");
      setConfirmingDelete(false);
      onDeleted();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure.message);
    } finally {
      setDeleting(false);
    }
  }

  async function assume() {
    const client = conversation.client;
    // Admin/gestor assumindo conversa de cliente de outro corretor: o cliente vai junto.
    if (canManage && client?.responsibleId && client.responsibleId !== currentUserId
      && !window.confirm(`Assumir esta conversa também transfere o cliente ${client.name || ""} de ${client.responsibleName || "outro corretor"} para você. Continuar?`)) {
      return;
    }
    setAssuming(true);
    await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/assign`, { method: "POST" }).catch(() => {});
    setAssuming(false);
    onChanged();
  }

  if (error) return <p className="m-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>;
  if (!conversation) {
    return <p className="flex flex-1 items-center justify-center gap-2 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Abrindo conversa...</p>;
  }

  const rows = [];
  let previousDay = "";
  let previousSender = "";
  for (const message of messages) {
    const key = dayKey(message.at);
    if (key !== previousDay) {
      rows.push({ kind: "day", key: `day-${key}`, label: formatDayLabel(message.at) });
      previousDay = key;
      previousSender = "";
    }
    // Primeira mensagem de uma sequência do mesmo remetente ganha o "rabinho" (como no WhatsApp).
    const sender = `${message.direction}|${message.senderType || ""}|${message.sentByName || ""}`;
    rows.push({ kind: "message", key: message.id, message, first: sender !== previousSender });
    previousSender = sender;
  }

  return (
    <>
      <header className="border-b border-line px-3 py-2.5 sm:px-4 sm:py-3">
        {/* Linha 1: identidade (o telefone fica no painel de informações) + ações */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-mist lg:hidden" aria-label="Voltar para as conversas">
            <ArrowLeft className="h-5 w-5 text-navy" />
          </button>
          <Avatar name={displayName(conversation)} photoUrl={conversation.photoUrl} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-black leading-tight text-navy">{displayName(conversation)}</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-extrabold ${conversation.window?.open ? "text-emerald-600" : "text-amber-700"}`}>
                <span className={`h-2 w-2 rounded-full ${conversation.window?.open ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden="true" />
                {conversation.window?.open ? "Janela aberta" : "Janela fechada"}
              </span>
              <ContactPresence conversation={conversation} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {conversation.client?.id && !conversation.private ? <button type="button" onClick={() => setDocumentSelectionOpen(true)} className="grid h-9 w-9 place-items-center rounded-full text-brand hover:bg-blue-50" aria-label="Analisar documentação" title="Analisar documentação"><FileText className="h-4 w-4" /><Search className="-ml-2 -mt-2 h-3 w-3" /></button> : null}
            {conversation.client?.id && hasDocumentReports && !conversation.private ? <button type="button" onClick={() => setDocumentsOpen(true)} className="grid h-9 w-9 place-items-center rounded-full text-brand hover:bg-blue-50" aria-label="Abrir relatórios de documentação" title="Relatórios"><LayoutList className="h-5 w-5" /></button> : null}
            {showAssume ? (
              <button type="button" onClick={assume} disabled={assuming} className="hidden rounded-full bg-navy px-3.5 py-2 text-xs font-extrabold text-white hover:bg-[#082f55] disabled:opacity-60 sm:inline-flex">
                {assuming ? "Assumindo…" : conversation.assignedUserId ? "Assumir" : "Assumir atendimento"}
              </button>
            ) : null}
            {!conversation.archivedReadOnly ? (
              // "Particular" (pedido do dono, 2026-10-09): contato pessoal vai para a aba Particular com o histórico inteiro,
              // deixa de ser cliente e mensagem nova não o traz de volta. Arquivar cliente fica no menu ⋮.
              <button
                type="button"
                onClick={() => setPrivate(!conversation.private)}
                disabled={archiving}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold hover:bg-mist disabled:opacity-50 ${conversation.private ? "text-brand" : "text-navy"}`}
                aria-label={conversation.private ? "Tirar de Particular" : "Mover para Particular"}
                title={conversation.private ? "Tirar de Particular (volta para a lista)" : "Particular: contato pessoal, sai da lista e não vira cliente"}
              >
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">{conversation.private ? "Tirar de Particular" : "Particular"}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleInfo}
              className={`grid h-9 w-9 place-items-center rounded-full hover:bg-mist ${infoAlways ? "" : "xl:hidden"} ${infoOpen ? "bg-blue-50 text-brand" : "text-navy"}`}
              aria-label="Informações do contato"
              title="Informações do contato"
            >
              <Info className="h-5 w-5" />
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                className={`grid h-9 w-9 place-items-center rounded-full hover:bg-mist ${menuOpen ? "bg-blue-50 text-brand" : "text-navy"}`}
                aria-label="Mais ações da conversa"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Mais ações"
              >
                <EllipsisVertical className="h-5 w-5" />
              </button>
              {menuOpen ? (
                <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-soft">
                  {conversation.client?.id && !conversation.archivedReadOnly ? (
                    <button type="button" role="menuitem" disabled={archiving} onClick={() => { setMenuOpen(false); archiveClient(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-navy hover:bg-mist disabled:opacity-50">
                      <Archive className="h-4 w-4" /> Arquivar cliente
                    </button>
                  ) : null}
                  {!conversation.archivedReadOnly && conversation.status !== "finished" ? (
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setResolved(!conversation.resolved); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-navy hover:bg-mist">
                      {conversation.resolved
                        ? <><RotateCcw className="h-4 w-4 text-brand" /> Desmarcar resolvida</>
                        : <><CircleCheck className="h-4 w-4 text-emerald-600" /> Marcar como resolvida</>}
                    </button>
                  ) : null}
                  {conversation.status !== "finished" ? (
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); changeStatus("finished"); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-navy hover:bg-mist">
                      <CheckCheck className="h-4 w-4 text-emerald-600" /> Finalizar conversa
                    </button>
                  ) : (
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); changeStatus("open"); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-navy hover:bg-mist">
                      <ArchiveRestore className="h-4 w-4 text-brand" /> Reabrir conversa
                    </button>
                  )}
                  {otherSlot && onOpenClientSlot ? (
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenClientSlot(conversation.client.id, otherSlot.slot).catch((failure) => setReactionError(failure.message)); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-navy hover:bg-mist">
                      <MessageCircle className="h-4 w-4 text-brand" /> Abrir no {otherSlot.label ? `Número ${otherSlot.slot} · ${otherSlot.label}` : `Número ${otherSlot.slot}`}
                    </button>
                  ) : null}
                  {conversation.canInternal ? (
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDeleteError(""); setConfirmingDelete(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold text-red-600 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" /> Excluir conversa
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Linha 2: corretor e sinais de atenção, cada selo numa linha só (rola de lado se não couber) */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {conversation.private ? <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600"><Lock className="h-3 w-3" aria-hidden="true" />Conversa particular</span>
            : conversation.client ? <ClientStatusBadge client={conversation.client} className="shrink-0 whitespace-nowrap" /> : <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">Não cadastrado</span>}
          <BrokerChip broker={conversation.broker} className="shrink-0 whitespace-nowrap" />
          <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{STATUS_LABELS[conversation.status] || conversation.status}</span>
          {conversation.private ? null : <WaitingBadge waiting={conversation.waiting} className="shrink-0 whitespace-nowrap" />}
        </div>

        {/* Linha 3 (celular): faixa larga para assumir o atendimento */}
        {showAssume ? (
          <button type="button" onClick={assume} disabled={assuming} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-navy text-sm font-extrabold text-white hover:bg-[#082f55] disabled:opacity-60 sm:hidden">
            {assuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {assuming ? "Assumindo…" : "Assumir atendimento"}
          </button>
        ) : null}
      </header>

      <div className="flex items-center gap-1.5 border-b border-line bg-white px-4 py-1.5" role="tablist" aria-label="Chat e Guia de Atendimento">
        <button type="button" role="tab" aria-selected={!guideOpen} onClick={() => onSetGuideOpen(false)} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-extrabold transition ${!guideOpen ? "bg-navy text-white" : "text-navy hover:bg-mist"}`}>
          <MessageCircle className="h-3.5 w-3.5" />Chat
        </button>
        <button type="button" role="tab" aria-selected={guideOpen} onClick={() => onSetGuideOpen(!guideOpen)} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-extrabold transition ${guideOpen ? "bg-brand text-white" : "border border-brand/30 text-brand hover:bg-blue-50"}`}>
          <BookOpen className="h-3.5 w-3.5" />Guia de Atendimento
        </button>
      </div>

      {conversation.summaryAvailable && !conversation.privateLocked ? <ConversationSummaryBar key={conversation.id} conversation={conversation} /> : null}

      <div ref={scrollRef} data-chat-wallpaper className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2 sm:px-[6%]" style={CHAT_WALLPAPER_STYLE}>
        {reactionError ? <p role="alert" className="mt-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{reactionError}</p> : null}
        {detail.hasMore ? <p className="mx-auto mt-2 w-fit rounded-lg bg-[#FFF5C4] px-3 py-1 text-center text-xs font-semibold text-[#54656F] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">Mostrando as últimas mensagens da conversa.</p> : null}
        {rows.map((row) => (row.kind === "day" ? (
          <div key={row.key} className="flex justify-center pb-1 pt-3">
            <span className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-[#54656F] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">{row.label}</span>
          </div>
        ) : (
          <MessageBubble key={row.key} message={row.message} first={row.first} quoted={row.message.internalReplyTo ? byId.get(row.message.internalReplyTo) : byRefId.get(row.message.replyToMessageId)} onOpenActions={setActionTarget} contact={audioContact} canInternal={Boolean(conversation.canInternal)} transcription={Boolean(conversation.transcriptionAvailable)} />
        )))}
        {!rows.length ? <p className="mx-auto mt-8 w-fit rounded-lg bg-white/90 px-4 py-2 text-center text-sm font-semibold text-[#54656F]">{conversation.privateLocked ? "Conversa particular. Para usar este contato no CRM, tire-o de Particular." : "Nenhuma mensagem nesta conversa."}</p> : null}
      </div>

      {conversation.privateLocked ? null : conversation.archivedReadOnly ? (
        // Cliente arquivado (WA-13): só o dono abre, pelo card, para LER. Fica fora da caixa do Chat.
        <p role="status" className="border-t border-line bg-amber-50 px-4 py-3 text-center text-xs font-bold text-amber-800">Cliente arquivado — conversa fora do Chat, somente leitura. Desarquive o cliente para voltar a conversar.</p>
      ) : (
        // chat-composer-safe: no app "Chat" da tela inicial a caixa fica acima do traço do iPhone (app/globals.css).
        <div className="chat-composer-safe">
          <Composer canManage={canManage} conversation={conversation} insertRequest={insertRequest} internalRequest={internalRequest} replyTo={replyTo} onClearReply={() => setReplyTo(null)} editTarget={editTarget} onClearEdit={() => setEditTarget(null)} onSent={onChanged} />
        </div>
      )}

      {actionTarget ? <MessageActionsMenu target={actionTarget} onClose={() => setActionTarget(null)} onReply={startReply} onReact={reactTo} onEdit={startEdit} onDelete={deleteForEveryone}
        onForward={conversation.archivedReadOnly ? null : setForwardMessage} onAddNote={conversation.canInternal ? addToNotes : null}
        onReplyInternal={conversation.canInternal ? (message) => { setEditTarget(null); setReplyTo(message); setInternalRequest((value) => value + 1); } : null} /> : null}
      {forwardMessage ? <ForwardDialog message={forwardMessage} currentConversationId={conversation.id} onClose={() => setForwardMessage(null)} onSent={onChanged} /> : null}

      {documentSelectionOpen ? <ChatDocumentSelection conversationId={conversation.id} initialMessages={messages} onClose={() => setDocumentSelectionOpen(false)} onAnalyzed={() => { setHasDocumentReports(true); setDocumentSelectionOpen(false); setDocumentsOpen(true); }} /> : null}
      {documentsOpen && conversation.client?.id ? <ClientDocumentsModal client={{ id: conversation.client.id, fullName: conversation.client.name || displayName(conversation) }} conversationId={conversation.id} canSendToCca canManage={canManage} canEditRules={canEditRules} reportsOnly onNewAnalysis={() => { setDocumentsOpen(false); setDocumentSelectionOpen(true); }} onClose={() => setDocumentsOpen(false)} /> : null}

      {confirmingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" onClick={() => !deleting && setConfirmingDelete(false)}>
          <div className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-soft" onClick={(event) => event.stopPropagation()}>
            <p id="delete-conversation-title" className="text-lg font-black text-navy">Excluir esta conversa?</p>
            <p className="mt-2 text-sm font-semibold leading-5 text-slate-600">A conversa será removida da caixa de atendimento. Essa ação não excluirá o cadastro do cliente.</p>
            {deleteError ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{deleteError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting} className="rounded-full border border-line px-4 py-2 text-sm font-extrabold text-navy hover:border-brand disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={deleteConversation} disabled={deleting} className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir conversa
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChatDocumentSelection({ conversationId, initialMessages, onClose, onAnalyzed }) {
  const [messages, setMessages] = useState(initialMessages);
  const [selected, setSelected] = useState([]);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 100);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [phase, setPhase] = useState("selection");
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [failedFiles, setFailedFiles] = useState([]);
  const [pdfPages, setPdfPages] = useState({});
  const [retryBatchId, setRetryBatchId] = useState("");
  const [error, setError] = useState("");
  const runningRef = useRef(false);
  const requestKeyRef = useRef("");
  const eligible = messages.filter((message) => !message.internal && (["text", "button", "interactive"].includes(message.type) && message.body?.trim() || ["image", "document"].includes(message.type)));

  useEffect(() => {
    if (phase !== "analyzing") return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => setProgress((current) => Math.max(current, chatDocumentProgress(Date.now() - started))), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const openPreview = useCallback((message) => setPreview(message), []);
  const markPreviewUnavailable = useCallback((id) => setFailedFiles((current) => current.includes(id) ? current : [...current, id]), []);
  const notePdfPages = useCallback((id, count) => setPdfPages((current) => current[id] === count ? current : { ...current, [id]: count }), []);
  const close = () => { if (!runningRef.current) preview ? setPreview(null) : onClose(); };

  async function loadOlder() {
    if (loadingOlder || runningRef.current) return;
    setLoadingOlder(true); setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversationId}?before=${encodeURIComponent(messages[0]?.at || "")}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.messages)) throw new Error("Falha ao buscar mensagens anteriores.");
      setMessages((current) => [...data.messages.filter((entry) => !current.some((existing) => existing.id === entry.id)), ...current]); setHasMore(Boolean(data.hasMore));
    } catch { setError("Não foi possível carregar mensagens anteriores. Tente novamente."); }
    finally { setLoadingOlder(false); }
  }

  async function waitForResult(batchId) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      let response;
      try { response = await fetch(`/api/admin/client-documents/batches/${batchId}`, { cache: "no-store" }); } catch { continue; }
      if (!response.ok) continue;
      const data = await response.json().catch(() => ({}));
      if (data.batch?.status === "failed") { setRetryBatchId(batchId); throw new Error("Análise não concluída."); }
      if (data.batch?.status === "analyzed") return data.batch;
    }
    throw new Error("Tempo de análise excedido.");
  }

  async function analyze() {
    if (runningRef.current || !selected.length) return;
    runningRef.current = true; setPhase("analyzing"); setProgress(0); setError("");
    if (!requestKeyRef.current) requestKeyRef.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/client-documents/from-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageIds: selected, requestKey: requestKeyRef.current, retryBatchId }) });
      const data = await response.json();
      if (!response.ok || !data.batch?.id) throw new Error("Não foi possível iniciar a análise.");
      const batch = data.batch.status === "analyzed" ? data.batch : await waitForResult(data.batch.id);
      setProgress(100); setPhase("complete");
      window.setTimeout(() => onAnalyzed(batch), 700);
    } catch (caught) {
      console.error("Falha na análise documental do Chat:", caught);
      setError("Não foi possível concluir a análise."); setPhase("failed");
    } finally { runningRef.current = false; }
  }
  const step = progress < 12 ? "Preparando documentos..." : progress < 29 ? "Identificando informações..." : progress < 47 ? "Conferindo documentos..." : progress < 64 ? "Cruzando dados do cliente..." : progress < 79 ? "Aplicando regras documentais..." : progress < 91 ? "Verificando pendências..." : "Finalizando análise...";
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-navy/60 p-3" role="dialog" aria-modal="true" aria-label="Selecionar documentação" onMouseDown={close}>
    <div className="relative flex max-h-[min(85dvh,calc(100dvh-32px))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-black text-navy">Analisar documentação</h2><button type="button" disabled={phase === "analyzing" || phase === "complete"} onClick={close} aria-label="Fechar" className="disabled:opacity-40"><X className="h-5 w-5" /></button></div>
      {phase === "analyzing" || phase === "complete" ? <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-2 text-center" aria-live="polite">
        <div className="relative grid h-52 w-52 place-items-center">
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="96" stroke="#e7eef8" strokeWidth="9" fill="none" /><circle cx="110" cy="110" r="96" stroke="#2676c4" strokeWidth="9" strokeLinecap="round" fill="none" strokeDasharray={2 * Math.PI * 96} strokeDashoffset={2 * Math.PI * 96 * (1 - progress / 100)} style={{ transition: "stroke-dashoffset 250ms ease-out" }} /></svg>
          <div className="relative flex flex-col items-center"><div className="relative h-14 w-14"><FileText className="h-14 w-14 text-navy/75" strokeWidth={1.4} /><Search className="chat-doc-scan absolute left-6 top-5 h-8 w-8 text-brand" strokeWidth={2} /></div><strong className="mt-2 text-3xl font-black text-navy">{progress}%</strong></div>
        </div>
        <p className="mt-5 text-lg font-black text-navy">{phase === "complete" ? "✓ Análise concluída" : "Analisando documentação"}</p>
        <p className="mt-1 text-sm text-muted">{phase === "complete" ? "Abrindo resultado..." : step}</p>
      </div> : <>
        <p className="mb-3 text-xs text-muted">Selecione apenas arquivos e mensagens relacionados à documentação.</p>
        {error ? <p role="alert" className="mb-2 text-sm text-red-700">{error}</p> : null}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5">{eligible.map((message) => {
          const media = ["image", "document"].includes(message.type);
          const unsupported = media && !/pdf|image\/(jpeg|png|webp)/i.test(`${message.media?.mime || ""} ${message.media?.name || ""}`) && message.type !== "image";
          return <div key={message.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-line p-2 text-sm text-navy">
            <input type="checkbox" aria-label={`Selecionar ${message.media?.name || "mensagem"}`} disabled={unsupported} checked={selected.includes(message.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} />
            {media ? <ChatDocumentThumbnail message={message} onPreview={openPreview} onUnavailable={markPreviewUnavailable} onPageCount={notePdfPages} /> : null}
            <div className="min-w-0 flex-1"><span className="block text-xs font-bold text-muted">{message.direction === "inbound" ? "Cliente" : "Equipe"} · {media ? message.type === "image" ? "Imagem" : pdfPages[message.id] ? `PDF · ${pdfPages[message.id]} página(s)` : "PDF/arquivo" : "Mensagem"}</span>
              {media ? <button type="button" onClick={() => openPreview(message)} className="block max-w-full break-all text-left text-sm text-navy underline-offset-2 hover:underline">{message.media?.name || "Arquivo"}</button> : <span className="block break-words">{message.body?.slice(0, 320)}</span>}
              {media && failedFiles.includes(message.id) ? <span className="block text-xs text-red-700">Não foi possível carregar a prévia</span> : null}{unsupported ? <span className="block text-xs text-muted">Formato não suportado para análise</span> : null}</div>
          </div>;
        })}</div>
        {hasMore ? <button type="button" disabled={loadingOlder} onClick={loadOlder} className="mt-2 text-xs font-bold text-brand disabled:opacity-50">{loadingOlder ? "Carregando..." : "Carregar mensagens anteriores"}</button> : null}
        <div className="mt-3 flex justify-end gap-2"><button type="button" className="premium-button-secondary px-4 py-2 text-sm" onClick={onClose}>Cancelar</button><button type="button" className="premium-button-primary px-4 py-2 text-sm disabled:opacity-50" disabled={!selected.length || loadingOlder} onClick={analyze}>{phase === "failed" ? "Tentar novamente" : `Analisar ${selected.length} selecionado(s)`}</button></div>
      </>}
      {preview ? <div className="absolute inset-0 z-10 flex flex-col bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onMouseDown={(event) => event.stopPropagation()}><div className="mb-2 flex min-w-0 items-center justify-between gap-2"><strong className="min-w-0 truncate text-sm text-navy">{preview.media?.name || "Documento"}</strong><button type="button" aria-label="Fechar prévia" onClick={() => setPreview(null)}><X className="h-5 w-5" /></button></div>{failedFiles.includes(preview.id) ? <p className="mb-2 text-xs text-red-700">Não foi possível carregar a prévia</p> : null}{preview.type === "image" ? <img src={preview.media?.url || `/api/admin/whatsapp-chat/media/${preview.id}`} alt={preview.media?.name || "Imagem"} className="min-h-0 flex-1 object-contain" onError={() => markPreviewUnavailable(preview.id)} /> : <iframe title="Prévia do PDF" src={`${preview.media?.url || `/api/admin/whatsapp-chat/media/${preview.id}`}#page=1`} className="min-h-0 flex-1 rounded-lg border border-line" onError={() => markPreviewUnavailable(preview.id)} />}{preview.type === "document" ? <a href={preview.media?.url || `/api/admin/whatsapp-chat/media/${preview.id}`} target="_blank" rel="noreferrer" className="mt-2 self-end text-xs font-bold text-brand">Abrir documento completo</a> : null}</div> : null}
      <style jsx global>{`@keyframes chatDocScan { 0%,100% { transform: translate(-9px,-6px); } 50% { transform: translate(8px,5px); } } .chat-doc-scan { animation: chatDocScan 2.4s ease-in-out infinite; } @media (prefers-reduced-motion: reduce) { .chat-doc-scan { animation: none; } }`}</style>
    </div>
  </div>;
}

const ChatDocumentThumbnail = memo(function ChatDocumentThumbnail({ message, onPreview, onUnavailable, onPageCount }) {
  const holder = useRef(null);
  const canvas = useRef(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const url = message.media?.url || `/api/admin/whatsapp-chat/media/${message.id}`;
  const pdf = message.type === "document" && /pdf/i.test(`${message.media?.mime || ""} ${message.media?.name || ""}`);
  useEffect(() => {
    if (!pdf || !holder.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { rootMargin: "120px" });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [pdf]);
  useEffect(() => {
    if (!pdf || !visible) return undefined;
    let cancelled = false;
    let loadingTask;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ url, disableStream: true });
        const document = await loadingTask.promise;
        if (!cancelled) onPageCount(message.id, document.numPages);
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scaled = page.getViewport({ scale: Math.min(1, 70 / viewport.width) });
        if (cancelled || !canvas.current) return;
        const element = canvas.current;
        element.width = Math.ceil(scaled.width * Math.min(devicePixelRatio || 1, 2));
        element.height = Math.ceil(scaled.height * Math.min(devicePixelRatio || 1, 2));
        await page.render({ canvas: element, canvasContext: element.getContext("2d"), viewport: scaled, transform: [element.width / scaled.width, 0, 0, element.height / scaled.height, 0, 0] }).promise;
        if (!cancelled) setReady(true);
      } catch { if (!cancelled) onUnavailable(message.id); }
    })();
    return () => { cancelled = true; loadingTask?.destroy(); };
  }, [pdf, visible, url, message.id, onUnavailable, onPageCount]);
  return <button ref={holder} type="button" aria-label={`Prévia de ${message.media?.name || "arquivo"}`} onClick={() => onPreview(message)} className="relative grid h-[70px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-mist">
    {message.type === "image" ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onLoad={() => setReady(true)} onError={() => onUnavailable(message.id)} /> : <><FileText className="absolute h-7 w-7 text-brand/40" /><canvas ref={canvas} className={`relative max-h-full max-w-full object-contain ${ready ? "opacity-100" : "opacity-0"}`} /></>}
  </button>;
});

// "Rabinho" do balão (só na primeira mensagem de uma sequência).
function BubbleTail({ outbound }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 13" className={`absolute top-0 h-[13px] w-2 ${outbound ? "-right-2" : "-left-2 -scale-x-100"}`}>
      <path d="M0 0h6.2c1.4 0 2.2 1.5 1.4 2.6L0 13z" fill={outbound ? "#D9FDD3" : "#FFFFFF"} />
    </svg>
  );
}

// Hora + ✓/✓✓ dentro do balão, canto inferior direito.
function BubbleMeta({ message, outbound }) {
  return (
    <>
      {message.editedAt ? <span title={message.originalBody ? `Original: ${message.originalBody}` : undefined}>editada</span> : null}
      <span>{TIME_FORMATTER.format(new Date(message.at))}</span>
      {outbound ? <StatusTicks status={message.status} /> : null}
    </>
  );
}

// Prévia de link externo: buscada uma vez por link (cache da página) na rota autenticada do Chat; o servidor baixa o
// Open Graph com proteção contra SSRF. Sem prévia/erro → null e o balão mostra só o link azul (como no WhatsApp).
const externalPreviewRequests = new Map();
function useLinkPreview(message) {
  const url = message.linkPreview ? "" : message.linkPreviewUrl || "";
  const [external, setExternal] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    let request = externalPreviewRequests.get(url);
    if (!request) {
      request = fetch(`/api/admin/whatsapp-chat/link-preview?url=${encodeURIComponent(url)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => data?.preview || null)
        .catch(() => null);
      externalPreviewRequests.set(url, request);
    }
    request.then((preview) => { if (alive) setExternal(preview); });
    return () => { alive = false; };
  }, [url]);
  return message.linkPreview || (url && external?.url ? external : null);
}

// Cartão de prévia do link dentro do balão (imagem grande, título, descrição e domínio), como no WhatsApp.
function LinkPreviewCard({ preview, outbound }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(preview.image) && !imageFailed;
  return (
    <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}
      className={`-mx-1 -mt-0.5 mb-1 block overflow-hidden rounded-md ${outbound ? "bg-[#C9EFC1]" : "bg-[#F0F2F5]"} hover:brightness-[0.98]`}>
      {showImage ? (
        <img src={preview.image} alt={preview.imageAlt || ""} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)}
          className="block aspect-[1200/630] w-full bg-black/5 object-cover" />
      ) : null}
      <span className="block px-2.5 py-2">
        {preview.title ? <span className="line-clamp-2 text-sm font-semibold leading-5 text-[#111B21]">{preview.title}</span> : null}
        {preview.description ? <span className="mt-0.5 line-clamp-2 text-[13px] leading-[1.3] text-[#54656F]">{preview.description}</span> : null}
        {preview.domain ? <span className="mt-1 flex items-center gap-1 text-[13px] text-[#54656F]"><Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{preview.domain}</span></span> : null}
      </span>
    </a>
  );
}

function MessageBubble({ message, first = true, quoted, onOpenActions, contact = null, canInternal = false, transcription = false }) {
  const hasActions = message.internal ? canInternal : (message.canReply || message.canReact || message.canEdit || message.canDelete || Boolean(message.body) || canInternal);
  const trigger = useMessageActionTrigger((point) => onOpenActions({ message, ...point }), hasActions);
  const linkPreview = useLinkPreview(message);
  if (message.internal) {
    // Nota interna: centralizada, azul tracejada e com cadeado — nunca parece mensagem enviada ao cliente.
    return (
      <div className={`flex justify-center ${first ? "mt-2.5" : "mt-1"}`}>
        <div data-internal-message {...trigger} data-message-id={message.id} className="max-w-[88%] select-text rounded-lg border border-dashed border-brand/50 bg-[#EAF2FE] px-3 py-1.5 text-navy shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none sm:max-w-[70%]">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wide text-brand"><Lock className="h-3 w-3" aria-hidden="true" />Interno • {message.sentByName || "Equipe"} <span className="font-semibold normal-case tracking-normal text-[#54656F]">· o cliente não vê</span></p>
          {quoted || message.internalReplyTo ? (
            <div className="mb-1 rounded-md border-l-4 border-brand bg-white/70 px-2 py-1 text-xs">
              <span className="block font-bold text-brand">{quoted ? (quoted.internal ? `Interno • ${quoted.sentByName || "Equipe"}` : quoted.direction === "inbound" ? "Cliente" : quoted.sentByName || "Equipe") : "Em resposta a"}</span>
              <span className="block truncate text-[#54656F]">{(quoted?.body ? stripWhatsappFormatting(quoted.body) : "") || (quoted ? MEDIA_LABELS[quoted.type] : "Mensagem anterior")}</span>
            </div>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-sm leading-5 text-[#111B21]"><MessageText text={message.body} /></p>
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium text-[#54656F]">
            <span>{TIME_FORMATTER.format(new Date(message.at))}</span>
            {/* ✓ enviada · ✓✓ entregue (apareceu na lista do corretor) · ✓✓ azul lida (ele abriu a conversa) */}
            <StatusTicks status={message.status} />
          </div>
        </div>
      </div>
    );
  }
  const outbound = message.direction === "outbound";
  const failed = message.status === "failed";
  const isMedia = message.type !== "text" && message.type !== "button" && message.type !== "interactive";
  const label = MEDIA_LABELS[message.type] || "Mensagem";
  const automation = outbound && message.senderType === "automation";
  const showSender = outbound && message.senderType === "user" && message.sentByName && first;
  // Hora "flutuando" no fim do texto (como no WhatsApp) — também quando há botão embaixo: a hora fica no canto
  // do texto, acima da linha separadora do botão.
  const metaInline = Boolean(message.body) && !message.revoked;

  return (
    <div className={`group flex items-center gap-1 ${outbound ? "justify-end" : "justify-start"} ${first ? "mt-2.5" : "mt-0.5"} ${message.reactions?.length ? "mb-4" : ""}`}>
      {hasActions && outbound ? <MessageMoreButton onOpen={(point) => onOpenActions({ message, ...point })} /> : null}
      <div {...trigger} data-message-id={message.id} className={`relative min-w-[84px] max-w-[80%] select-text rounded-lg px-2 [@media(pointer:coarse)]:select-none pb-1.5 pt-1.5 text-[#111B21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] [-webkit-touch-callout:none] sm:max-w-[65%] ${linkPreview ? "w-[300px] sm:w-[340px]" : ""} ${
        outbound ? "bg-[#D9FDD3]" : "bg-white"
      } ${first ? (outbound ? "rounded-tr-none" : "rounded-tl-none") : ""} ${failed ? "ring-1 ring-red-300" : ""}`}>
        {first ? <BubbleTail outbound={outbound} /> : null}
        {automation ? (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[#54656F]" title={message.automationKind === "flow" ? "Mensagem automática de um Fluxo" : "Mensagem automática"}><Zap className="h-3 w-3" aria-hidden="true" />Automação</p>
        ) : null}
        {showSender ? (
          <p className="mb-0.5 truncate text-xs font-bold text-brand">{message.sentByName}</p>
        ) : null}
        {message.replyToMessageId ? (
          <div className={`mb-1 rounded-md border-l-4 border-brand px-2 py-1 text-xs ${outbound ? "bg-[#CFE9C7]" : "bg-[#F0F2F5]"}`}>
            <span className="block font-bold text-brand">{quoted ? (quoted.direction === "inbound" ? "Cliente" : quoted.sentByName || "Equipe") : "Em resposta a"}</span>
            <span className="block truncate text-[#54656F]">{(quoted?.body ? stripWhatsappFormatting(quoted.body) : "") || (quoted ? MEDIA_LABELS[quoted.type] : "Mensagem anterior")}</span>
          </div>
        ) : null}
        {message.revoked ? (
          <p className="flex items-start gap-1.5 text-sm italic text-[#54656F]"><Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{message.revokedBy === "customer" ? "O cliente apagou esta mensagem" : "Mensagem apagada"}{message.originalBody ? <span className="mt-1 block text-[11px] font-semibold not-italic">Original (só administrador vê): {message.originalBody}</span> : null}</span></p>
        ) : message.media ? <><MediaPreview media={message.media} type={message.type} outbound={outbound}
          avatarName={outbound ? message.sentByName || "Equipe" : contact?.name || ""} avatarUrl={outbound ? "" : contact?.photoUrl || ""} />
          {message.type === "audio" ? <AudioTranscript message={message} enabled={transcription} /> : null}</> : isMedia ? (
          <p className="text-sm italic text-[#54656F]">{message.type === "unsupported"
            ? "[Mensagem não suportada] — o WhatsApp não entregou o conteúdo (ex.: visualização única, enquete ou contato). Peça para o cliente reenviar como arquivo ou abra no WhatsApp do celular."
            : `[${label}] — abra no WhatsApp para visualizar`}</p>
        ) : null}
        {message.shortcut ? <p className="mb-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#54656F]">Atalho · {message.shortcut}</p> : null}
        {linkPreview ? <LinkPreviewCard preview={linkPreview} outbound={outbound} /> : null}
        {message.body ? (
          <div className="relative">
            <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.35] sm:text-sm sm:leading-5">
              <MessageText text={message.body} />
              {/* Reserva o espaço da hora no fim da última linha */}
              {metaInline ? <span aria-hidden="true" className="invisible ml-2 inline-flex items-center gap-1 text-[11px]"><BubbleMeta message={message} outbound={outbound} /></span> : null}
            </p>
            {metaInline ? (
              <span className="absolute -bottom-0.5 right-0 inline-flex items-center gap-1 text-[11px] font-medium text-[#54656F]"><BubbleMeta message={message} outbound={outbound} /></span>
            ) : null}
          </div>
        ) : null}
        {message.linkLabel ? (
          // Botão de link (Fluxo/atalho), como no WhatsApp: linha separadora + texto azul centralizado com ícone.
          message.linkUrl ? (
            <a href={message.linkUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} title={message.linkUrl}
              className="-mx-2 mt-1.5 flex min-h-[40px] items-center justify-center gap-1.5 border-t border-black/10 px-2 pt-1.5 text-sm font-semibold text-[#0B6BAF] hover:bg-black/[0.03]"><ExternalLink className="h-4 w-4" aria-hidden="true" />{message.linkLabel}</a>
          ) : (
            <p className="-mx-2 mt-1.5 flex items-center justify-center gap-1.5 border-t border-black/10 px-2 pt-1.5 text-sm font-semibold text-[#0B6BAF]"><ExternalLink className="h-4 w-4" aria-hidden="true" />{message.linkLabel}</p>
          )
        ) : null}
        {message.buttons?.length ? (
          <div className="-mx-2 mt-1.5 divide-y divide-black/10 border-t border-black/10">
            {message.buttons.map((label, index) => (
              <span key={index} className="block px-2 py-1.5 text-center text-sm font-semibold text-[#0B6BAF]">{label}</span>
            ))}
          </div>
        ) : null}
        {metaInline ? null : (
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium text-[#54656F]"><BubbleMeta message={message} outbound={outbound} /></div>
        )}
        {message.reactions?.length ? (
          <div className={`absolute -bottom-3.5 flex gap-0.5 ${outbound ? "right-2" : "left-2"}`} aria-label="Reações">
            {message.reactions.map((entry) => <span key={entry.sender} title={entry.sender === "customer" ? "Cliente" : "Equipe"} className="rounded-full border border-[#E9EDEF] bg-white px-1.5 text-sm leading-6 shadow-sm">{entry.emoji}</span>)}
          </div>
        ) : null}
        {failed ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] font-bold text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Não enviada{message.errorMessage ? ` — ${message.errorMessage}` : ""}{message.errorCode ? ` (código ${message.errorCode})` : ""}</span>
          </p>
        ) : null}
      </div>
      {hasActions && !outbound ? <MessageMoreButton onOpen={(point) => onOpenActions({ message, ...point })} /> : null}
    </div>
  );
}

// Encaminhar (2026-10-09, "igual ao WhatsApp"): escolhe outra conversa e envia o TEXTO da mensagem por ela,
// pela mesma API do compositor (o servidor decide o número e confere a permissão).
function ForwardDialog({ message, currentConversationId, onClose, onSent }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ filter: "all" });
      if (query.trim()) params.set("q", query.trim());
      fetch(`/api/admin/whatsapp-chat/conversations?${params.toString()}`, { cache: "no-store" })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (cancelled) return;
          if (!ok) throw new Error(data.error || "Não foi possível carregar as conversas.");
          setItems((data.conversations || []).filter((item) => item.id !== currentConversationId).slice(0, 40));
        })
        .catch((failure) => { if (!cancelled) setError(failure.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 300 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, currentConversationId]);

  async function forwardTo(item) {
    setSendingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${item.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.body })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível encaminhar.");
      onSent?.();
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSendingId("");
    }
  }

  // Portal no <body>: acima da barra inferior do celular.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Encaminhar mensagem" className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-base font-bold text-navy">Encaminhar para…</p>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-bold text-slate-600">Cancelar</button>
        </div>
        <p className="mx-4 mt-3 line-clamp-2 rounded-lg bg-[#D9FDD3] px-3 py-2 text-sm text-[#111B21]">{message.body}</p>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar conversa"
          className="mx-4 mt-3 rounded-full bg-[#F0F2F5] px-4 py-2.5 text-base outline-none" />
        {error ? <p role="alert" className="mx-4 mt-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p> : null}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {loading && !items.length ? <p className="px-4 py-6 text-center text-sm text-muted">Carregando…</p> : null}
          {!loading && !items.length ? <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma conversa encontrada.</p> : null}
          {items.map((item) => (
            <button key={item.id} type="button" disabled={Boolean(sendingId)} onClick={() => forwardTo(item)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 disabled:opacity-50">
              <Avatar name={displayName(item)} photoUrl={item.photoUrl} size={40} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#111B21]">{displayName(item)}</span>
              {sendingId === item.id ? <Loader2 className="h-4 w-4 animate-spin text-brand" aria-label="Enviando" /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// "⋯" ao lado da mensagem: aparece ao passar o mouse (computador/navegador) e
// pelo teclado; em tela de toque some — lá a ação é pressionar e segurar.
function MessageMoreButton({ onOpen }) {
  return (
    <button type="button" aria-label="Ações da mensagem" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onOpen({ x: rect.left, y: rect.bottom, touch: false }); }}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 opacity-0 transition hover:bg-white hover:text-navy focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden">
      <EllipsisVertical className="h-4 w-4" />
    </button>
  );
}

// Computador: Enter envia e Shift+Enter quebra a linha. Em tela de toque (celular/tablet) o Enter continua quebrando
// a linha, como no WhatsApp do celular. Não dispara enquanto o teclado está compondo acento (isComposing).
function sendOnEnter(event, send, canSend) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
  event.preventDefault();
  if (canSend) send();
}

function StatusTicks({ status }) {
  if (status === "read") return <CheckCheck className="h-4 w-4 text-[#53BDEB]" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="h-4 w-4 text-[#667781]" aria-label="Entregue" />;
  if (status === "sent") return <Check className="h-4 w-4 text-[#667781]" aria-label="Enviada" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-500" aria-label="Falhou" />;
  return <Loader2 className="h-3 w-3 animate-spin" aria-label="Enviando" />;
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// Mídia RECEBIDA do cliente é servida pela rota autenticada do CRM; "?download=1" salva com o nome original.
function downloadUrl(media) {
  return media.inbound ? `${media.url}?download=1` : media.url;
}

function DownloadLink({ media, label = "Baixar" }) {
  return (
    <a href={downloadUrl(media)} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-brand hover:bg-white">
      <Download className="h-3.5 w-3.5" /> {label}
    </a>
  );
}

function InboundImage({ media, type }) {
  const [src, setSrc] = useState(media.url);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="mb-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
        Não foi possível carregar {type === "sticker" ? "a figurinha" : "a imagem"}.{" "}
        <button type="button" onClick={() => { setFailed(false); setSrc(`${media.url}?retry=1&t=${Date.now()}`); }} className="underline">Tentar de novo</button>
      </div>
    );
  }
  return (
    <div className="mb-1">
      <a href={media.url} target="_blank" rel="noreferrer" className="block">
        <img src={src} alt={media.name || "Imagem"} onError={() => setFailed(true)} className={type === "sticker" ? "max-h-40 w-auto" : "max-h-72 w-full rounded-md object-cover"} loading="lazy" />
      </a>
      {media.inbound && type !== "sticker" ? <div className="mt-1"><DownloadLink media={media} /></div> : null}
    </div>
  );
}

// Transcrição do áudio (2026-10-10): texto embaixo do áudio. Já transcrito = mostra; senão botão "Transcrever"
// (só quando o servidor tem o serviço configurado). O texto fica salvo — ninguém paga duas vezes pelo mesmo áudio.
function AudioTranscript({ message, enabled }) {
  const [text, setText] = useState(message.transcript || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setText(message.transcript || ""); }, [message.id, message.transcript]);
  if (text) return <p className="mt-1 whitespace-pre-line border-l-2 border-[#25D366]/50 pl-2 text-[13px] italic leading-5 text-[#3B4A54]">{text}</p>;
  if (!enabled || message.media?.state === "failed") return null;
  async function run() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/media/${message.id}/transcript`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível transcrever.");
      setText(data.transcript || "");
    } catch (runError) {
      setError(runError.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mt-1">
      <button type="button" onClick={run} disabled={loading} className="inline-flex items-center gap-1 text-[12px] font-extrabold text-brand hover:underline disabled:opacity-60">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} {loading ? "Transcrevendo…" : "Transcrever"}
      </button>
      {error ? <p className="text-[11px] font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

// Resumo da conversa por IA (2026-10-10): 3 linhas (o que quer, perfil, próximo passo). Sob demanda; fica salvo e
// avisa quando há mensagem nova depois do resumo ("Atualizar").
function ConversationSummaryBar({ conversation }) {
  const [summary, setSummary] = useState(conversation.aiSummary || null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function generate(force = false) {
    setLoading(true);
    setError("");
    setOpen(true);
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar o resumo.");
      setSummary({ text: data.text, generatedAt: data.generatedAt, stale: false });
    } catch (runError) {
      setError(runError.message);
    } finally {
      setLoading(false);
    }
  }
  const stale = summary?.stale || (conversation.aiSummary?.stale && summary === conversation.aiSummary);
  return (
    <div className="border-b border-line bg-[#F7F9FC] px-4 py-1.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => (summary && !open ? setOpen(true) : summary ? setOpen(false) : generate())} disabled={loading} className="inline-flex items-center gap-1.5 text-xs font-extrabold text-navy hover:text-brand disabled:opacity-60">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-brand" />}
          {loading ? "Resumindo…" : summary ? (open ? "Ocultar resumo" : "Ver resumo da conversa") : "Resumir conversa"}
        </button>
        {summary && (stale || open) && !loading ? (
          <button type="button" onClick={() => generate(true)} className="ml-auto text-[11px] font-extrabold text-brand hover:underline">{stale ? "Há mensagens novas · Atualizar" : "Atualizar"}</button>
        ) : null}
      </div>
      {open && summary?.text ? <p className="mt-1 whitespace-pre-line text-[13px] font-semibold leading-5 text-[#3B4A54]">{summary.text}</p> : null}
      {error ? <p className="mt-1 text-[11px] font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

function MediaPreview({ media, type, outbound = false, avatarName = "", avatarUrl = "" }) {
  if (type === "audio") return <ChatAudioPlayer src={media.url} mime={media.mime} state={media.state} outbound={outbound} avatarName={avatarName} avatarUrl={avatarUrl} />;
  if (type === "image" || type === "sticker") return <InboundImage media={media} type={type} />;
  if (media.state === "failed" && type !== "audio") {
    return <p className="mb-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Não foi possível baixar {MEDIA_LABELS[type]?.toLowerCase() || "o arquivo"} do WhatsApp. Abra no WhatsApp do celular.</p>;
  }
  // GIF (vídeo curto em loop, como no WhatsApp): toca sozinho e sem som.
  if (type === "video" && media.gif) {
    return (
      <div className="mb-1">
        <video autoPlay loop muted playsInline preload="metadata" src={media.url} className="max-h-72 w-full rounded-md bg-black" aria-label="GIF" />
        <span className="mt-0.5 inline-block rounded bg-navy/70 px-1.5 text-[10px] font-extrabold text-white">GIF</span>
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className="mb-1">
        <video controls playsInline preload="metadata" src={media.url} className="max-h-72 w-full rounded-md bg-black" />
        {media.inbound ? <div className="mt-1"><DownloadLink media={media} /></div> : null}
      </div>
    );
  }
  // Documento (PDF, Word, Excel…) como no WhatsApp: ícone colorido pelo tipo, nome e "PDF · 169 KB"; tocar abre, a seta baixa.
  const size = formatFileSize(media.size);
  const kind = documentKind(media);
  return (
    <div className="mb-1 flex items-center gap-1 rounded-md bg-black/[0.05]">
      <a href={media.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pl-2 pr-1 hover:bg-black/[0.03]" title="Abrir">
        <DocumentIcon kind={kind} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-all text-sm font-semibold leading-5 text-[#111B21]">{media.name || "Documento"}</span>
          <span className="block text-[11px] font-medium text-[#54656F]">{[kind.label, size].filter(Boolean).join(" · ")}<span className="sr-only"> — abrir</span></span>
        </span>
      </a>
      <a href={downloadUrl(media)} className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#54656F] hover:bg-black/5 hover:text-[#111B21]" aria-label={`Baixar ${media.name || "documento"}`} title="Baixar">
        <Download className="h-5 w-5" />
      </a>
    </div>
  );
}

const DOCUMENT_KINDS = [
  { test: /pdf/i, label: "PDF", tag: "PDF", color: "#E5252A" },
  { test: /word|msword|\.docx?$/i, label: "Word", tag: "DOC", color: "#2B5797" },
  { test: /sheet|excel|\.xlsx?$|\.csv$/i, label: "Planilha", tag: "XLS", color: "#1D7044" },
  { test: /presentation|powerpoint|\.pptx?$/i, label: "Apresentação", tag: "PPT", color: "#C8471F" },
  { test: /text\/plain|\.txt$/i, label: "Texto", tag: "TXT", color: "#54656F" }
];

function documentKind(media) {
  const hint = `${media.mime || ""} ${media.name || ""}`;
  const found = DOCUMENT_KINDS.find((item) => item.test.test(hint));
  if (found) return found;
  const extension = /\.([a-z0-9]{1,5})$/i.exec(media.name || "")?.[1]?.toUpperCase() || "";
  return { label: extension || "Arquivo", tag: extension.slice(0, 4) || "DOC", color: "#54656F" };
}

function DocumentIcon({ kind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 30 36" className="h-9 w-[30px] shrink-0">
      <path d="M3 0h17l10 10v23a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Z" fill={kind.color} />
      <path d="M20 0v7a3 3 0 0 0 3 3h7Z" fill="#FFFFFF" opacity=".35" />
      <text x="15" y="27" textAnchor="middle" fontSize="8" fontWeight="800" fill="#FFFFFF" fontFamily="system-ui, sans-serif">{kind.tag}</text>
    </svg>
  );
}

// Reduz fotos (máx. 1600 px, JPEG) para caber no limite de envio e no do WhatsApp.
async function prepareImageFile(file) {
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

function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Campo de mensagem cresce sozinho conforme o corretor digita (até um teto, depois rola por dentro) — em vez de
// mostrar só 1 linha e esconder o resto do texto na hora de reler/corrigir.
function useAutoGrowTextarea(ref, value) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

// Tipo do anexo escolhido -> como aparece/é enviado. Fotos JPG/PNG/HEIC são
// reduzidas no navegador; o resto vai como está (vídeo até 16 MB direto ao
// storage). A decisão final do tipo é do servidor (mediaSendPlan).
const DIRECT_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
const VIDEO_MIMES = ["video/mp4", "video/3gpp", "video/quicktime"];

function attachmentKind(file) {
  const type = String(file.type || "").toLowerCase();
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type.startsWith("image/")) return "image";
  if (VIDEO_MIMES.includes(type)) return "video";
  return "document";
}

function Composer({ canManage, conversation, insertRequest = null, internalRequest = 0, replyTo, onClearReply, editTarget = null, onClearEdit = () => {}, onSent }) {
  const [text, setText] = useState("");
  // "/atalho" (2026-10-10): só quando o campo inteiro é "/" + palavra (sem anexo, resposta ou edição).
  const slashMatch = /^\/(\S{0,30})$/.exec(text);
  const slashQuery = slashMatch ? slashMatch[1] : null;
  const textareaRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState(null); // { file, previewUrl, kind, asGif, asSticker }
  const [progress, setProgress] = useState("");
  const fileInput = useRef(null);
  const recorder = useAudioRecorder();
  const canRecord = useMemo(() => audioRecordingSupported(), []);
  const [internalMode, setInternalMode] = useState(false);
  useEffect(() => {
    if (internalRequest) setInternalMode(true);
  }, [internalRequest]);
  useAutoGrowTextarea(textareaRef, text);

  useEffect(() => {
    setText("");
    setError("");
    setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    recorder.cancel();
    setInternalMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Mensagem vinda do Guia de Atendimento: entra no campo (a pessoa revisa e envia). Só vale para a conversa aberta.
  useEffect(() => {
    if (!insertRequest || insertRequest.conversationId !== conversation.id) return;
    setInternalMode(false);
    setText(insertRequest.text);
    setError("");
    const handle = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.nonce]);

  useEffect(() => {
    if (replyTo) setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, [replyTo?.id]);

  // Editar: o texto atual entra no campo; enviar grava a correção no WhatsApp.
  useEffect(() => {
    if (!editTarget) return undefined;
    setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setInternalMode(false);
    setText(editTarget.body || "");
    setError("");
    const handle = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget?.id]);

  function insertEmoji(emoji) {
    const element = textareaRef.current;
    const startAt = element?.selectionStart ?? text.length;
    const endAt = element?.selectionEnd ?? text.length;
    setText(text.slice(0, startAt) + emoji + text.slice(endAt));
    setTimeout(() => {
      if (!element) return;
      element.focus();
      element.setSelectionRange(startAt + emoji.length, startAt + emoji.length);
    }, 0);
  }

  const canInternal = Boolean(conversation.canInternal);

  // MODO INTERNO: mensagem só para a equipe (nunca vai ao WhatsApp). Funciona também com a janela de 24h fechada.
  if (internalMode && canInternal) {
    return <InternalComposer conversationId={conversation.id} replyTo={replyTo} onClearReply={onClearReply} onExit={() => setInternalMode(false)} onSent={onSent} />;
  }

  async function postMedia(file, caption = "", { asGif = false } = {}) {
    const base = `/api/admin/whatsapp-chat/conversations/${conversation.id}/media`;
    let response;
    if (file.size > DIRECT_UPLOAD_THRESHOLD) {
      // Arquivo grande: vai direto ao storage (a Vercel não aceita > ~4,5 MB).
      setProgress("Enviando arquivo…");
      const targetResponse = await fetch(`${base}/upload-target`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: file.type, fileName: file.name, size: file.size })
      });
      const target = await targetResponse.json().catch(() => ({}));
      if (!targetResponse.ok) throw new Error(target.error || "Não foi possível preparar o envio do arquivo.");
      const upload = await fetch(target.signedUrl, { method: "PUT", headers: { "Content-Type": file.type, "x-upsert": "true" }, body: file });
      if (!upload.ok) throw new Error("Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.");
      setProgress("Enviando pelo WhatsApp…");
      response = await fetch(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target.path, mimeType: file.type, fileName: file.name, caption, asGif })
      });
    } else {
      const form = new FormData();
      form.append("file", file);
      if (caption) form.append("caption", caption);
      if (asGif) form.append("asGif", "1");
      response = await fetch(base, { method: "POST", body: form });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível enviar o arquivo.");
  }

  async function pickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const kind = attachmentKind(file);
      const prepared = kind === "image" ? await prepareImageFile(file) : file;
      if (prepared.size > ATTACHMENT_MAX_BYTES) throw new Error("O arquivo passa de 16 MB (limite do WhatsApp). Envie um menor.");
      const previewable = ["image", "gif", "webp", "video"].includes(kind);
      setAttachment((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return { file: prepared, kind, previewUrl: previewable ? URL.createObjectURL(prepared) : "", asGif: false, asSticker: kind === "webp" };
      });
    } catch (pickError) {
      setError(pickError.message);
    }
  }

  function clearAttachment() {
    setAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  async function send() {
    const value = text.trim();
    if ((!value && !attachment) || sending || conversation.awaitingCustomer || conversation.individualSendDisabled || (!conversation.sessionUserId && conversation.window?.open === false)) return;
    if (replyTo && attachment) { setError("Para responder a uma mensagem específica, envie apenas texto."); return; }
    setSending(true);
    setError("");
    try {
      if (editTarget) {
        if (!value) throw new Error("Digite o novo texto.");
        const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/messages/${editTarget.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: value })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Não foi possível editar a mensagem.");
        setText("");
        onClearEdit();
      } else if (attachment) {
        // .webp sem "figurinha" vai como foto comum (convertida para JPEG).
        const file = attachment.kind === "webp" && !attachment.asSticker ? await prepareImageFile(attachment.file) : attachment.file;
        await postMedia(file, attachment.kind === "webp" && attachment.asSticker ? "" : value, { asGif: attachment.kind === "video" && attachment.asGif });
        clearAttachment();
      } else {
        const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value, replyToMessageId: replyTo?.id || "" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Não foi possível enviar a mensagem.");
      }
      if (!editTarget) setText("");
      onClearReply();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
      setProgress("");
      onSent();
    }
  }

  async function sendAudio() {
    const result = await recorder.finish();
    if (!result) {
      setError(recorder.error || "Não foi possível preparar o áudio.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await postMedia(new File([result.blob], result.fileName, { type: result.blob.type }));
    } catch (audioError) {
      setError(audioError.message);
    } finally {
      setSending(false);
      onSent();
    }
  }

  const expires = conversation.window.expiresAt ? TIME_FORMATTER.format(new Date(conversation.window.expiresAt)) : "";
  const msLeft = conversation.window.expiresAt ? new Date(conversation.window.expiresAt).getTime() - Date.now() : 0;
  const closingSoon = conversation.window.open && msLeft > 0 && msLeft <= 2 * 60 * 60 * 1000;
  const minutesLeft = Math.max(1, Math.round(msLeft / 60000));
  const timeLeftLabel = minutesLeft >= 60 ? `${Math.floor(minutesLeft / 60)}h${String(minutesLeft % 60).padStart(2, "0")}` : `${minutesLeft} min`;
  const recording = recorder.state === "recording";
  const processing = recorder.state === "processing";
  const hasContent = Boolean(text.trim()) || Boolean(attachment);
  const shownError = error || recorder.error;
  // Chat só responde: contato que ainda não escreveu -> envio pelo app do celular do corretor (ou link para o cliente chamar).
  const individualOff = conversation.individualSendDisabled === true;
  // Número oficial com a janela de 24 h fechada: texto livre bloqueado, o corretor segue pelo celular.
  const windowClosed = !conversation.sessionUserId && conversation.window?.open === false;
  const awaiting = (conversation.awaitingCustomer === true || individualOff || windowClosed) && !editTarget;
  const customerDigits = String(conversation.phone || "").replace(/\D/g, "");
  const phoneSendHref = customerDigits ? `https://wa.me/${customerDigits}${text.trim() ? `?text=${encodeURIComponent(text.trim())}` : ""}` : "";
  // Link para o cliente te chamar: SEMPRE o número oficial (dono, 2026-10-09) — o atendimento segue pelo Chat.
  const callLink = `https://wa.me/${OFFICIAL_WHATSAPP_DIGITS}?text=${encodeURIComponent("Olá, preenchi meu cadastro. Gostaria de receber a minha simulação.")}`;
  async function copyCallLink() {
    try {
      await navigator.clipboard.writeText(callLink);
      setError("");
      setProgress("Link copiado. Envie ao cliente para ele te chamar no WhatsApp.");
      setTimeout(() => setProgress(""), 4000);
    } catch {
      setError("Não foi possível copiar. Link: " + callLink);
    }
  }

  return (
    <div className="border-t border-[#E9EDEF] bg-[#F6F5F3] px-2 pb-2 pt-2 sm:px-3">
      {shownError ? <p className="mb-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{shownError}</p> : null}
      {replyTo ? <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand bg-blue-50 px-3 py-2 text-xs text-navy"><Reply className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Respondendo: {replyTo.body || MEDIA_LABELS[replyTo.type] || "Mensagem"}</span><button type="button" onClick={onClearReply} aria-label="Cancelar resposta" className="grid h-8 w-8 place-items-center"><X className="h-4 w-4" /></button></div> : null}
      {editTarget ? <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-navy"><Pencil className="h-4 w-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1 truncate">Editando: {editTarget.body}</span><button type="button" onClick={() => { onClearEdit(); setText(""); }} aria-label="Cancelar edição" className="grid h-8 w-8 place-items-center"><X className="h-4 w-4" /></button></div> : null}
      {progress ? <p className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-brand"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</p> : null}
      {/* Aviso "envio pelo WhatsApp pessoal desativado" removido (pedido do dono, 2026-10-09: poluía a tela); o botão verde segue abrindo o WhatsApp do celular. */}
      {awaiting && !individualOff ? (
        <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-5 text-navy">
          {windowClosed && !individualOff && conversation.awaitingCustomer !== true ? (
            <>
              <p className="font-black">A janela de 24 horas deste cliente fechou.</p>
              <p className="mt-0.5">Pelo número oficial só dá para responder até 24 h depois da última mensagem do cliente. Escreva o texto abaixo e toque no botão verde para enviar pelo WhatsApp do celular.</p>
            </>
          ) : (
            <>
              <p className="font-black">Este cliente ainda não escreveu para você.</p>
              <p className="mt-0.5">Pelo CRM só é possível responder quem já mandou mensagem. Escreva o texto abaixo e toque no botão verde: o WhatsApp do celular abre com a mensagem pronta e você só envia. Ou peça para o cliente te chamar.</p>
            </>
          )}
          {callLink ?<button type="button" onClick={copyCallLink} className="mt-1.5 inline-flex min-h-9 items-center rounded-full border border-amber-300 bg-white px-3 text-xs font-extrabold text-navy hover:border-brand">Copiar link para o cliente te chamar</button> : null}
        </div>
      ) : null}

      {attachment ? (
        <div className="mb-2 rounded-2xl border border-line bg-mist/60 p-2">
          <div className="flex items-center gap-3">
            {attachment.kind === "video" && attachment.previewUrl ? <video src={attachment.previewUrl} muted playsInline className="h-14 w-14 rounded-xl bg-black object-cover" />
              : attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
              : <span className="grid h-14 w-14 place-items-center rounded-xl bg-white text-brand"><FileText className="h-6 w-6" /></span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-navy">{attachment.file.name}</span>
              <span className="block text-[11px] font-bold text-muted">{formatFileSize(attachment.file.size)}{attachment.kind === "webp" && attachment.asSticker ? " · vai como figurinha (sem legenda)" : attachment.kind === "gif" ? " · GIF vai como arquivo (abre animado)" : " · a mensagem digitada vai como legenda"}</span>
            </span>
            <button type="button" onClick={clearAttachment} aria-label="Remover anexo" className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
          </div>
          {attachment.kind === "video" && attachment.file.type === "video/mp4" ? (
            <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 px-1 text-xs font-bold text-navy">
              <input type="checkbox" checked={attachment.asGif} onChange={(event) => setAttachment((current) => ({ ...current, asGif: event.target.checked }))} className="h-4 w-4" />
              Enviar como GIF (toca sozinho, sem som, em loop)
            </label>
          ) : null}
          {attachment.kind === "webp" ? (
            <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 px-1 text-xs font-bold text-navy">
              <input type="checkbox" checked={attachment.asSticker} onChange={(event) => setAttachment((current) => ({ ...current, asSticker: event.target.checked }))} className="h-4 w-4" />
              Enviar como figurinha
            </label>
          ) : null}
        </div>
      ) : null}

      {conversation.simulationFirst ? (
        // Regra do dono (2026-10-09): cliente com dados preenchidos recebe primeiro a simulação (link da apresentação).
        <p role="status" className="mb-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          Primeiro a simulação: este cliente já preencheu os dados. Faça a simulação pelo card do cliente e envie o link da apresentação — as outras mensagens ficam liberadas depois.
        </p>
      ) : null}
      {!awaiting && !recording && !processing ? (
        <p className="mb-1.5 px-2 text-[11px] font-semibold text-[#54656F]">
          Enviando por: <span className="font-extrabold text-[#111B21]">{conversation.sessionUserId && !conversation.replyViaOfficial ? `WhatsApp pessoal — ${conversation.sessionLabel || "Número 1"}` : "número oficial"}</span>
        </p>
      ) : null}

      {recording || processing ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={recorder.cancel} disabled={processing} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-50 disabled:opacity-40" aria-label="Cancelar gravação">
            <Trash2 className="h-5 w-5" />
          </button>
          <div className="flex h-11 flex-1 items-center gap-3 rounded-full bg-white px-4 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-black tabular-nums text-red-700">{formatDuration(recorder.seconds)}</span>
            <span className="text-xs font-bold text-red-600">{processing ? "Preparando…" : "Gravando…"}</span>
          </div>
          <button type="button" onClick={sendAudio} disabled={processing || sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-white transition hover:bg-[#082f55] disabled:opacity-40" aria-label="Enviar áudio">
            {processing || sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <input ref={fileInput} type="file" accept="image/*,video/mp4,video/3gpp,video/quicktime,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" className="hidden" onChange={pickFile} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={sending || awaiting || Boolean(replyTo) || Boolean(editTarget)} aria-label="Anexar foto, vídeo ou arquivo" title={replyTo ? "Respostas específicas aceitam texto" : "Anexar"} className="grid h-11 w-10 shrink-0 place-items-center rounded-full text-[#3B4A54] transition hover:bg-black/5 hover:text-[#111B21] disabled:opacity-40">
            <Plus className="h-6 w-6" strokeWidth={2.25} />
          </button>
          <WhatsappChatShortcuts canManage={canManage} conversationId={conversation.id} disabled={sending || awaiting || Boolean(replyTo) || Boolean(editTarget)} onSent={onSent} slashQuery={slashQuery} onSlashClose={() => setText("")} />
          {/* Campo arredondado branco, com emoji à esquerda e o modo interno à direita (como a câmera no WhatsApp) */}
          <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] border border-transparent bg-white shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
            <EmojiPicker disabled={sending} onPick={insertEmoji} />
            <textarea
              ref={textareaRef}
              className="max-h-[40dvh] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-[15px] leading-6 text-[#111B21] outline-none placeholder:text-[#54656F] sm:text-sm sm:leading-6"
              disabled={sending}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // Atalho com "/": Esc limpa; Enter não envia "/texto" como mensagem (escolha o atalho na lista).
                if (slashQuery !== null && event.key === "Escape") { event.preventDefault(); setText(""); return; }
                if (slashQuery !== null && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); return; }
                sendOnEnter(event, send, !sending && !awaiting && hasContent);
              }}
              placeholder={editTarget ? "Novo texto da mensagem…" : attachment ? "Legenda (opcional)…" : "Mensagem"}
              aria-label="Mensagem"
              rows={1}
              value={text}
            />
            {canInternal && !editTarget ? <InternalToggle active={false} disabled={sending} onClick={() => setInternalMode(true)} /> : null}
          </div>
          {awaiting ? (
            <a
              href={phoneSendHref || undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir no WhatsApp do celular"
              title="Abrir no WhatsApp do celular"
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25D366] text-white transition hover:bg-[#1fb857] ${phoneSendHref ? "" : "pointer-events-none opacity-40"}`}
            >
              <Send className="h-5 w-5" />
            </a>
          ) : hasContent || !canRecord ? (
            <button
              type="button"
              onClick={send}
              disabled={sending || !hasContent}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-white transition hover:bg-[#082f55] disabled:opacity-40"
              aria-label={editTarget ? "Salvar edição" : "Enviar mensagem"}
            >
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          ) : (
            <button type="button" onClick={recorder.start} disabled={sending || Boolean(replyTo) || Boolean(editTarget)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-white transition hover:bg-[#082f55] disabled:opacity-40" aria-label="Gravar áudio" title={replyTo ? "Respostas específicas aceitam texto" : "Gravar áudio"}>
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {closingSoon ? <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700">Atenção: a janela de resposta livre fecha em {timeLeftLabel} (às {expires}). Depois disso, responda pelo WhatsApp do celular.</p> : expires ? <p className="mt-1.5 px-1 text-[10px] font-bold text-slate-400">Mensagem livre permitida até {expires} (24h após a última mensagem do contato).</p> : null}
    </div>
  );
}

// Botão do modo interno: cinza (envio normal ao cliente) -> azul (modo interno ativo), com transição suave.
function InternalToggle({ active, disabled = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={active ? "Desativar modo interno" : "Ativar modo interno (mensagem só para a equipe)"}
      title={active ? "Modo interno ativo — clique para voltar ao WhatsApp" : "Mensagem interna (o cliente não verá)"}
      className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-extrabold transition-colors duration-200 disabled:opacity-40 ${active ? "bg-blue-100 text-brand" : "text-brand hover:bg-blue-50"}`}
    >
      {/* Mais visível (dono, 2026-10-09: "cadê o botão de chat interno?"): cadeado + "Interno". */}
      <Lock className="h-4 w-4" />
      <span>Interno</span>
    </button>
  );
}

function InternalComposer({ conversationId, replyTo = null, onClearReply = () => {}, onExit, onSent }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);
  useAutoGrowTextarea(textareaRef, text);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversationId}/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value, replyToMessageId: replyTo?.id || "" })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a mensagem interna.");
      setText("");
      onClearReply();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
      onSent();
    }
  }

  return (
    <div data-internal-composer className="border-t border-brand/25 bg-blue-50/60 p-3 transition-colors duration-200">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
          <MessageSquareText className="h-3 w-3" /> Modo interno
        </span>
        <span className="text-[11px] font-bold text-brand">Só a equipe vê estas mensagens.</span>
      </div>
      {error ? <p className="mb-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
      {replyTo ? <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand bg-white px-3 py-2 text-xs text-navy"><Reply className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Respondendo no interno: {replyTo.body || MEDIA_LABELS[replyTo.type] || "Mensagem"}</span><button type="button" onClick={onClearReply} aria-label="Cancelar resposta" className="grid h-8 w-8 place-items-center"><X className="h-4 w-4" /></button></div> : null}
      <div className="flex items-end gap-1">
        <InternalToggle active onClick={onExit} />
        <textarea
          ref={textareaRef}
          autoFocus
          className="max-h-[40dvh] min-h-11 flex-1 resize-none overflow-y-auto rounded-2xl border border-brand/30 bg-white px-4 py-2.5 text-sm font-semibold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => sendOnEnter(event, send, !sending && Boolean(text.trim()))}
          placeholder="Mensagem interna — o cliente não verá esta mensagem"
          rows={1}
          value={text}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-[#082f55] disabled:opacity-40"
          aria-label="Salvar mensagem interna"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

// "Online / visto por último" do contato (pedido do dono, 2026-10-09): só aparece quando existe — conversa do WhatsApp
// pessoal com o número conectado e contato que não esconde o "visto por último". Atualiza a cada 1 min com a conversa aberta.
function presenceLabel(presence) {
  if (!presence?.available) return "";
  if (presence.state === "composing") return "digitando…";
  if (presence.state === "recording") return "gravando áudio…";
  if (presence.state === "available") return "online";
  if (!presence.lastSeen) return "";
  const seen = new Date(presence.lastSeen);
  const tz = "America/Sao_Paulo";
  const day = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(seen);
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86_400_000));
  if (day(seen) === today) return `visto por último hoje às ${time}`;
  if (day(seen) === yesterday) return `visto por último ontem às ${time}`;
  return `visto por último em ${new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(seen)} às ${time}`;
}

function ContactPresence({ conversation }) {
  const [presence, setPresence] = useState(null);
  const id = conversation.id;
  const personal = Boolean(conversation.sessionUserId) && !conversation.private;

  useEffect(() => {
    setPresence(null);
    if (!personal) return undefined;
    let cancelled = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/admin/whatsapp-chat/conversations/${id}/presence`, { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!cancelled && response.ok) setPresence(data);
      } catch { /* sem rede: tenta na próxima */ }
    }
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, personal]);

  const label = presenceLabel(presence);
  if (!label) return null;
  const live = presence.state && presence.state !== "unavailable" && presence.state !== "paused";
  return <span className={`min-w-0 truncate text-[11px] font-bold ${live ? "text-emerald-600" : "text-[#667781]"}`}>· {label}</span>;
}

// Editar o nome do contato (pedido do dono, 2026-10-09): o nome do WhatsApp às vezes vem grudado ou com emoji — quem
// atende a conversa corrige. Vale para a conversa e, com cliente vinculado, também para o nome do cliente.
function ContactNameEditor({ conversation, onChanged }) {
  const current = displayName(conversation);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEditing(false);
    setError("");
  }, [conversation.id]);

  function start() {
    setValue(current);
    setError("");
    setEditing(true);
  }

  async function save(event) {
    event?.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactName: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o nome.");
      setEditing(false);
      onChanged();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <p className="mt-3 flex items-center justify-center gap-1.5 font-black text-navy">
        <span className="min-w-0 truncate">{current}</span>
        <button type="button" onClick={start} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-brand hover:bg-blue-50" aria-label="Editar nome do contato" title="Editar nome">
          <Pencil className="h-4 w-4" />
        </button>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="mx-auto mt-3 max-w-xs space-y-2 text-left">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={80}
        autoFocus
        className="h-11 w-full rounded-2xl border border-line bg-white px-3 text-base font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
        aria-label="Nome do contato"
      />
      {conversation.client ? <p className="text-xs font-semibold text-muted">Também atualiza o nome no cadastro do cliente.</p> : null}
      {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={() => setEditing(false)} className="h-10 flex-1 rounded-full border border-line text-sm font-extrabold text-navy">Cancelar</button>
        <button type="submit" disabled={saving} className="h-10 flex-1 rounded-full bg-navy text-sm font-extrabold text-white disabled:opacity-60">{saving ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}

function ContactPanel({ brokers = [], canManage = false, detail, onChanged }) {
  const { conversation } = detail;
  const [assigning, setAssigning] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  // Mesmo endpoint que o card do cliente na tela de Clientes já usa — muda lá também.
  async function changeStatus(status) {
    if (!conversation.client?.id) return;
    setChangingStatus(true);
    await fetch(`/api/simulation-registrations/${conversation.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }).catch(() => {});
    setChangingStatus(false);
    onChanged();
  }

  async function assignTo(userId) {
    const target = brokers.find((broker) => broker.id === userId);
    if (target && conversation.client && conversation.client.responsibleId !== userId
      && !window.confirm(`Atribuir esta conversa a ${target.name} também transfere o cliente ${conversation.client.name || ""} de ${conversation.client.responsibleName || "sem corretor"} para ${target.name}. Continuar?`)) {
      return;
    }
    setAssigning(true);
    await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId || null })
    }).catch(() => {});
    setAssigning(false);
    onChanged();
  }
  const client = conversation.client;
  const [name, setName] = useState(conversation.name || "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const digits = useMemo(() => String(conversation.phone || "").replace(/\D/g, ""), [conversation.phone]);

  useEffect(() => {
    setName(conversation.name || "");
    setError("");
  }, [conversation.id, conversation.name]);

  async function addToCrm() {
    setAdding(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/add-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível adicionar ao CRM.");
      onChanged();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setAdding(false);
    }
  }

  const openClientHref = client ? `/admin/simulacoes?query=${encodeURIComponent(client.code || digits)}&clientId=${client.id}` : "";

  return (
    <div className="space-y-4 p-5">
      <div className="text-center">
        <div className="mx-auto w-fit"><Avatar name={displayName(conversation)} photoUrl={conversation.photoUrl} size={72} /></div>
        <ContactNameEditor conversation={conversation} onChanged={onChanged} />
        <p className="text-sm font-bold text-muted">{formatPhone(conversation.phone)}</p>
      </div>

      {client ? (
        <div className="space-y-2 rounded-2xl border border-line bg-mist/40 p-4 text-sm">
          <InfoRow label="Cliente" value={client.name ? `${client.name}${client.code ? ` · ${client.code}` : ""}` : "Vinculado"} />
          <InfoRow label="Corretor do cliente" value={client.responsibleName || "Sem corretor"} />
          <InfoRow label="Atendendo agora" value={conversation.assignedUserId ? conversation.broker?.name || "—" : "Ninguém"} />
          <InfoRow label="Etapa" value={client.funnelStage || client.statusLabel} />
          <InfoRow label="Situação" value={client.statusLabel} />
          <InfoRow label="Simulação" value={client.simulationFilled ? "Dados preenchidos" : "Ainda não preencheu"} />
          <InfoRow label="Origem" value={client.origin || (conversation.origin?.kind === "meta_ad" ? "Anúncio Meta" : "—")} />
          <Link href={openClientHref} className="mm-app-hide mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-navy/15 bg-white text-sm font-extrabold text-navy transition hover:border-brand">
            <ExternalLink className="h-4 w-4" /> Abrir cliente
          </Link>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-800">Contato não cadastrado</p>
          <p className="text-xs font-bold text-amber-700">Este telefone ainda não está em Clientes. Novos contatos são cadastrados sozinhos; se este ficou de fora (por exemplo, sem corretor disponível na roleta), adicione aqui.</p>
          <label className="block text-xs font-black text-navy">
            Nome
            <input
              className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do cliente"
              value={name}
            />
          </label>
          {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
          <LinkExistingClient conversationId={conversation.id} initialQuery={digits.slice(-8)} onLinked={onChanged} />
          <button
            type="button"
            onClick={addToCrm}
            disabled={adding || !name.trim()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-navy text-sm font-extrabold text-white transition hover:bg-[#082f55] disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Adicionar ao CRM
          </button>
        </div>
      )}

      {canManage ? (
        <label className="block rounded-2xl border border-line p-4 text-xs font-black text-navy">
          Atribuir conversa a
          <select
            className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
            disabled={assigning}
            onChange={(event) => assignTo(event.target.value)}
            value={conversation.assignedUserId || ""}
          >
            <option value="">Ninguém (liberar — volta pra roleta)</option>
            {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.online ? "🟢 " : ""}{broker.name}</option>)}
          </select>
        </label>
      ) : null}

      {canManage && client ? (
        <label className="block rounded-2xl border border-line p-4 text-xs font-black text-navy">
          Status do cliente
          <select
            className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
            disabled={changingStatus}
            onChange={(event) => changeStatus(event.target.value)}
            value={client.status || ""}
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}

      {conversation.origin?.kind === "meta_ad" ? (
        <p className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold text-blue-700">Conversa iniciada por anúncio da Meta.</p>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-right font-bold text-navy">{value || "—"}</span>
    </div>
  );
}
