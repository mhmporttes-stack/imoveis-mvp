"use client";

import { useCallback, useEffect, useState } from "react";
import HenryVoiceView from "@/components/henry/HenryVoiceView";
import { OPENING_SOUND_AT_S, playHenryOpeningSound } from "@/components/henry/HenryOpeningScene";
import { henryPulseConfig } from "@/lib/henry-pulse-core.mjs";

// Vitrine DEV do Henry (HENRY-1): mesma apresentação do painel, com sinal de áudio SIMULADO e conversa fictícia.
const SAMPLE_TURNS = [
  { role: "user", text: "Bom dia, Henry" },
  { role: "assistant", text: "Bom dia, Matheus. Segue o relatório do dia. Hoje você tem 3 clientes aguardando resposta e 2 simulações a conferir." },
  { role: "user", text: "Henry, quem bateu a meta hoje?" },
  { role: "assistant", text: "Ana e Bruno já bateram a meta; a equipe está em 72%." }
];

// Cena de busca (dono, 2026-10-22): "buscando" = dados transparentes atrás do anel; "procurando corretor" = scanner;
// "achou corretor" = card com foto ligado ao anel; "relatório" = detalhe em lista na tela. Números e pessoas FICTÍCIOS.
const avatar = (bg, skin, hair) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><path d="M14 27c0-12 8-19 18-19s18 7 18 19c-3-5-9-8-18-8s-15 3-18 8z" fill="${hair}"/><circle cx="32" cy="27" r="11" fill="${skin}"/><path d="M10 64c3-13 12-19 22-19s19 6 22 19z" fill="#1E9BFF" opacity="0.85"/></svg>`)}`;
const AVATAR = avatar("#24507A", "#F3DCA6", "#3B2A1E");
const AVATAR_2 = avatar("#1B3B5E", "#D9A877", "#1A1410");
const SAMPLE_DETAIL = {
  title: "Relatório mensal",
  subtitle: "Últimos 30 dias (23/09 a 22/10)",
  sections: [
    { title: "Leads por origem", rows: [{ label: "Total", value: "214", note: "+12% (antes 191)" }, { label: "Anúncio", value: "128" }, { label: "Marketplace", value: "41" }, { label: "Outras origens", value: "45" }] },
    { title: "Funil", rows: [{ label: "Atendimento", value: "96" }, { label: "Simulação", value: "58" }, { label: "Documentação", value: "21" }, { label: "Enviados para aprovação", value: "12" }, { label: "Aprovados", value: "7" }, { label: "Vendas", value: "3", note: "igual" }] },
    { title: "Ranking e pontuação", rows: [{ label: "1º Ana", value: "412 pts" }, { label: "2º Bruno", value: "377 pts" }, { label: "3º Carla", value: "301 pts" }] },
    { title: "Meta Diária", rows: [{ label: "Equipe", value: "87%", note: "1.040 de 1.196 atividades" }] },
    { title: "Atenção agora", rows: [{ label: "Clientes aguardando resposta", value: "9" }, { label: "Clientes esfriados para você decidir", value: "2" }] }
  ]
};

// Cenas da RESPOSTA (dono, 2026-10-22: "cenas diferentes por tipo de pergunta"): uma conversa fictícia por tipo.
const ANSWER_SAMPLES = {
  numeros: { q: "Henry, como tá a prospecção hoje?", text: "Hoje a equipe fez 148 prospecções e 23 atendimentos; a Meta tá em 72% da equipe.", scene: { kind: "numeros" } },
  comparativo: {
    q: "Henry, compara essa semana com a passada",
    text: "Nos últimos 7 dias entraram 54 leads, um pouco mais que antes. Os detalhes estão na tela.",
    scene: { kind: "comparativo", chart: { currentLabel: "Últimos 7 dias", previousLabel: "09/10 a 15/10", rows: [{ label: "Leads", current: 54, previous: 47 }, { label: "Atendimentos", current: 31, previous: 35 }, { label: "Simulações", current: 18, previous: 12 }, { label: "Aprovados", current: 4, previous: 3 }, { label: "Vendas", current: 2, previous: 1 }] } }
  },
  cliente: {
    q: "Henry, como tá a cliente Fulana?",
    text: "A Fulana está em Documentação, com a Ana; último contato ontem.",
    scene: { kind: "cliente" },
    detail: { title: "Clientes: “Fulana”", subtitle: "1 resultado", sections: [{ title: "Fulana de Tal", rows: [{ label: "Etapa", value: "Documentação" }, { label: "Responsável", value: "Ana" }, { label: "Último contato", value: "21/10" }] }] }
  },
  web: {
    q: "Henry, vai chover amanhã em Marília?",
    text: "Segundo o Climatempo, amanhã tem chance de chuva à tarde em Marília.",
    scene: { kind: "web" },
    detail: { title: "Fontes da pesquisa", subtitle: "", sections: [{ title: "Fontes", rows: [{ label: "Previsão Marília", value: "climatempo.com.br", href: "https://www.climatempo.com.br" }, { label: "Tempo", value: "tempo.com", href: "https://www.tempo.com" }] }] }
  },
  memoria: {
    q: "Henry, lembra que sexta tem reunião com a Caixa",
    text: "Fechado, anotei.",
    scene: { kind: "memoria" },
    detail: { title: "Lembretes do Henry", subtitle: "3 anotados", sections: [{ title: "Lembretes", rows: [{ label: "sexta tem reunião com a Caixa", value: "" }] }] }
  },
  conversa: { q: "Boa noite, Henry, tudo bem?", text: "Boa noite, Matheus! E aí, tudo certo?", scene: { kind: "conversa" } },
  corretor: { q: "Henry, como foi a Ana no mês?", text: "A Ana fez 412 pontos e tá em 1º no ranking.", scene: { kind: "corretor" } }
};

// Cena de abertura do bom dia (?cena=abertura): o ▶ ao lado do microfone repete a cena (com o som). ?numeros=1 mostra a
// telemetria com números FICTÍCIOS (no painel ela só aparece com números reais já carregados).
const SAMPLE_TELEMETRY = [
  { label: "Clientes novos", value: 7 },
  { label: "Simulações enviadas", value: 4 },
  { label: "Aniversariantes", value: 2 }
];

// Música (dono, 2026-10-23): cena do Spotify por etapa (?cena=musica&etapa=connect|search|found|opening|playing|error|ciclo) e
// "Tocando agora" com as ondas sonoras no canto (?ondas=1; ?ondas=ciclo alterna tocando/pausado). Capa e faixa FICTÍCIAS.
const COVER = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8B85C"/><stop offset="1" stop-color="#7A3E12"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="32" r="17" fill="#07111F" opacity="0.85"/><circle cx="32" cy="32" r="4" fill="#E8B85C"/></svg>')}`;
const MUSIC_STAGES = {
  connect: { stage: "connect", query: "sertanejo raiz" },
  search: { stage: "search", query: "sertanejo raiz" },
  found: { stage: "found", query: "sertanejo raiz", name: "Sertanejo Raiz", artists: "playlist", image: COVER },
  opening: { stage: "opening", query: "sertanejo raiz", name: "Sertanejo Raiz", artists: "playlist", image: COVER },
  playing: { stage: "playing", query: "sertanejo raiz", name: "Sertanejo Raiz", artists: "playlist", image: COVER },
  error: { stage: "error", query: "sertanejo raiz", error: "Nenhum aparelho com o Spotify aberto." }
};
const MUSIC_CYCLE = ["connect", "search", "found", "playing"];
// Pulso do CRM (?pulso=1, rascunho HENRY-1 "Pulso"): eventos de EXEMPLO no mesmo formato do GET /api/admin/henry/pulse
// (nomes fictícios), com uma rajada de WhatsApp de vez em quando para ver o agrupamento ("Bruna enviou 5 mensagens").
const PULSE_TEAM = [["Gabriel", AVATAR], ["Bruna", ""], ["Caroline", AVATAR_2], ["Jennyfer", ""], ["Eduardo", ""], ["Ketlin", ""]];
const PULSE_CLIENTS = ["Maria", "João", "Ana", "Pedro", "Larissa", "Fernando", "Camila", "Rafael"];
const PULSE_SNIPPETS = ["Oi, tudo bem? Vi que preencheu o formulário…", "Segue a sua simulação, dá uma olhada", "Consegue me mandar o RG e o comprovante?", "Bora agendar a visita amanhã?"];
const PULSE_COLORS = ["#5cd6ff", "#ff9fb8", "#b59cff", "#9be7c4", "#ffd36b", "#7aa8ff"];
let pulseSeq = 0;
function samplePulseEvent(type, at, brokerIndex = Math.floor(Math.random() * PULSE_TEAM.length)) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const [name, photo] = PULSE_TEAM[brokerIndex];
  const broker = { name, photo, color: PULSE_COLORS[brokerIndex] };
  const base = { id: `demo:${(pulseSeq += 1)}`, type, at, broker, client: pick(PULSE_CLIENTS), link: { path: "/admin/simulacoes" } };
  if (type === "whatsapp") return { ...base, snippet: pick(PULSE_SNIPPETS), group: `whatsapp:${name}` };
  if (type === "messenger") return { ...base, broker: null, snippet: "", group: "messenger:auto" };
  if (type === "instagram") return { ...base, broker: null, client: "", tag: "MARKETPLACE", detail: "Jardim Itaipu" };
  if (type === "simulacao") return { ...base, broker: null };
  if (type === "cca") return { ...base, detail: "Menin" };
  if (type === "chegada") return { ...base, client: "" };
  if (type === "pontos") return { ...base, client: "", points: 50, detail: "Primeiro a chegar na imobiliária (dividido entre 2)" };
  return base;
}
async function samplePulsePoll() {
  const now = Date.now();
  const types = ["whatsapp", "messenger", "instagram", "lead", "simulacao", "cca", "chegada", "pontos"];
  const events = Array.from({ length: 6 }, (_, index) => samplePulseEvent(types[Math.floor(Math.random() * types.length)], new Date(now - (6 - index) * 3000).toISOString()));
  if (Math.random() < 0.5) for (let index = 0; index < 5; index += 1) events.push(samplePulseEvent("whatsapp", new Date(now - 1000 + index * 100).toISOString(), 1));
  return { enabled: true, events, now: new Date(now).toISOString() };
}

const SAMPLE_NOW_PLAYING = { isPlaying: true, name: "Evidências", artists: "Chitãozinho & Xororó", image: COVER, tempo: null };

const STATE_CYCLE = [
  { mode: "idle", kind: "", ms: 3000 },
  { mode: "waiting", kind: "", ms: 3500 },
  { mode: "listening", kind: "", ms: 2500 },
  { mode: "thinking", kind: "papo", ms: 3500 },
  { mode: "thinking", kind: "busca", ms: 4000 },
  { mode: "speaking", kind: "", ms: 3000 }
];

export default function HenryDemo({ mode: initialMode = "speaking", thinkingKind = "", stateCycle = false, expanded = true, capturing = false, scene = "", topic = "relatorio", brokerCount = 2, answer = "", opening: initialOpening = false, telemetry = false, musicStage = "", waves = "", pulse = false, alerts = false }) {
  const [cycleIndex, setCycleIndex] = useState(0);
  useEffect(() => {
    if (musicStage !== "ciclo") return undefined;
    const id = setTimeout(() => setCycleIndex((value) => (value + 1) % MUSIC_CYCLE.length), cycleIndex === 1 ? 2600 : 1900);
    return () => clearTimeout(id);
  }, [musicStage, cycleIndex]);
  const music = scene === "musica" ? MUSIC_STAGES[musicStage === "ciclo" ? MUSIC_CYCLE[cycleIndex] : musicStage] || MUSIC_STAGES.search : null;
  const [wavePlaying, setWavePlaying] = useState(true);
  useEffect(() => {
    if (waves !== "ciclo") return undefined;
    const id = setTimeout(() => setWavePlaying((value) => !value), wavePlaying ? 5000 : 2500);
    return () => clearTimeout(id);
  }, [waves, wavePlaying]);
  const nowPlaying = waves ? { ...SAMPLE_NOW_PLAYING, isPlaying: waves === "ciclo" ? wavePlaying : true } : null;
  const [opening, setOpening] = useState(initialOpening);
  const [openingKey, setOpeningKey] = useState(0);
  const playOpening = () => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) {
      window.__henryDemoAudio = window.__henryDemoAudio || new Context();
      window.__henryDemoAudio.resume?.();
      playHenryOpeningSound(window.__henryDemoAudio, OPENING_SOUND_AT_S);
    }
    setOpen(true);
    setOpeningKey((value) => value + 1);
    setOpening(true);
  };
  // "achou" (redesenho da cena, 2026-10-22): busca 2,6 s → resposta 3,4 s, em ciclo, para ver entrada/busca/achou/saída.
  const [cycleSearching, setCycleSearching] = useState(true);
  useEffect(() => {
    if (scene !== "achou") return undefined;
    const id = setTimeout(() => setCycleSearching((value) => !value), cycleSearching ? 2600 : 3400);
    return () => clearTimeout(id);
  }, [scene, cycleSearching]);
  const musicSpeaking = music?.stage === "playing" || music?.stage === "error";
  // ?estado=ciclo: parado → esperando → ouvindo → pensando → buscando → falando, para ver as transições (a rede se desfaz).
  const [stateIndex, setStateIndex] = useState(0);
  useEffect(() => {
    if (!stateCycle) return undefined;
    const id = setTimeout(() => setStateIndex((value) => (value + 1) % STATE_CYCLE.length), STATE_CYCLE[stateIndex].ms);
    return () => clearTimeout(id);
  }, [stateCycle, stateIndex]);
  const cycled = stateCycle ? STATE_CYCLE[stateIndex] : null;
  const thinkingAs = cycled ? cycled.kind : thinkingKind;
  const mode = cycled ? cycled.mode : scene === "achou" ? (cycleSearching ? "thinking" : "speaking") : music ? (musicSpeaking ? "speaking" : "thinking") : initialMode;
  const [muted, setMuted] = useState(false);
  const [vision, setVision] = useState(true);
  const [keyboard, setKeyboard] = useState(false);
  const [open, setOpen] = useState(expanded);
  // Avisos lidos (?avisos=1): FICTÍCIOS, um a cada ~2,6 s, o anterior fica apagado (mesma lista da tela cheia).
  const [alertList, setAlertList] = useState([]);
  useEffect(() => {
    if (!alerts) return undefined;
    const sample = [
      { kicker: "Cliente novo", text: "A Larissa chegou e está com a Caroline.", color: "#e9c27a" },
      { kicker: "Chegada na imobiliária", text: "O Gabriel chegou na imobiliária.", color: "#9be7c4" },
      { kicker: "Aviso da Central", text: "Reunião de equipe amanhã às 9h.", color: "#4fc3e0" }
    ];
    const timers = sample.map((item, index) => setTimeout(() => setAlertList((current) => [...current.map((old) => ({ ...old, read: true })), { ...item, id: String(index), read: false }]), 600 + index * 2600));
    return () => timers.forEach(clearTimeout);
  }, [alerts]);
  // Sinal simulado com "sílabas" (picos curtos) para ver a reação ao volume em cada estado.
  const getSignal = useCallback(() => {
    const t = Date.now() / 1000;
    const syllables = Math.max(0, Math.sin(t * 9.1)) * (0.55 + 0.45 * Math.sin(t * 1.3));
    if (mode === "speaking") return { mode, level: 0.2 + 0.75 * syllables };
    if (mode === "listening") return { mode, level: 0.1 + 0.7 * syllables };
    if (mode === "thinking") {
      // Rede neural: papo calmo; busca de dados intensa, com um "evento de progresso" a cada 1,6 s.
      const data = thinkingAs !== "papo";
      return { mode, level: 0.1, activity: data ? 0.9 : 0.3, burst: data ? Math.exp(-((t * 1000) % 1600) / 700) : 0 };
    }
    return { mode, level: 0 };
  }, [mode, thinkingAs]);
  const engaged = mode !== "idle";
  const allBrokers = [
    { id: "b1", firstName: "Ana", photoUrl: AVATAR, stats: [{ label: "pontos", value: "412" }, { label: "meta", value: "104%" }], position: 1, found: true },
    { id: "b2", firstName: "Bruno", photoUrl: "", stats: [{ label: "pontos", value: "377" }, { label: "vendas", value: "2" }], position: 2, found: true },
    { id: "b3", firstName: "Carla", photoUrl: AVATAR_2, stats: [{ label: "pontos", value: "301" }, { label: "meta", value: "88%" }], found: true }
  ];
  const brokers =
    scene === "procurando"
      ? [{ id: "b1", firstName: "Ana", photoUrl: AVATAR, stats: [], found: false }]
      : scene === "corretor"
        ? allBrokers.slice(0, Math.max(1, Math.min(3, brokerCount)))
        : answer === "corretor"
          ? allBrokers.slice(0, 1)
          : [];
  const sample = ANSWER_SAMPLES[answer];
  const turns = music
    ? [{ role: "user", text: "Henry, toca uma playlist de sertanejo raiz" }, ...(musicSpeaking ? [{ role: "assistant", text: music.stage === "playing" ? "Pronto, tá tocando! Sertanejo Raiz." : "Nenhum aparelho com o Spotify aberto. Abre o Spotify no celular ou no computador.", scene: { kind: "musica", music } }] : [])]
    : sample ? [{ role: "user", text: sample.q }, { role: "assistant", text: sample.text, scene: sample.scene, ...(sample.detail ? { detail: sample.detail } : {}) }] : scene === "relatorio" ? [...SAMPLE_TURNS.slice(0, 2), { role: "user", text: "Henry, quero o relatório mensal" }, { role: "assistant", text: "Nos últimos 30 dias entraram 214 leads, 128 de anúncio. Os detalhes estão na tela.", detail: SAMPLE_DETAIL }] : SAMPLE_TURNS;
  // Celular (< 768 px, ex.: 390×844): mesma apresentação do app, tocar para falar.
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return (
    <HenryVoiceView
      key={openingKey}
      pulse={pulse ? henryPulseConfig({}) : null}
      pulsePoll={pulse ? samplePulsePoll : undefined}
      onPulseOpen={(link) => console.info("[vitrine] Pulso abriria", link?.path)}
      morningPlay
      onMorningPlay={playOpening}
      opening={opening}
      alertList={alertList}
      onOpeningDone={() => setOpening(false)}
      openingTelemetry={telemetry ? SAMPLE_TELEMETRY : null}
      expanded={open}
      onExpand={() => setOpen(true)}
      onMinimize={() => setOpen(false)}
      status={{ idle: "Ouvindo — diga “Henry”", waiting: "Em conversa — pode falar sem dizer o nome (“obrigado, Henry” encerra)", listening: "Em conversa — pode falar sem dizer o nome (“obrigado, Henry” encerra)", thinking: "Pensando…", speaking: "Falando… diga “Henry” para interromper" }[mode] || ""}
      engaged={engaged}
      mobile={mobile}
      tapToTalk={mobile}
      inConversation={engaged}
      caption={{ thinking: SAMPLE_TURNS[2].text, speaking: SAMPLE_TURNS[3].text, listening: SAMPLE_TURNS[3].text }[mode] || ""}
      turns={mode === "idle" && (thinkingAs || stateCycle) ? [] : turns}
      searching={mode === "thinking"}
      dataScene={mode === "thinking" && thinkingAs !== "papo"}
      sceneTopic={music ? "music" : thinkingAs === "papo" ? "geral" : topic}
      music={music}
      nowPlaying={nowPlaying}
      brokers={brokers}
      micOff={muted}
      onToggleMute={() => setMuted((value) => !value)}
      getSignal={getSignal}
      showKeyboard={keyboard}
      onToggleKeyboard={() => setKeyboard((value) => !value)}
      onSubmitTyped={(event) => event.preventDefault()}
      vision={vision}
      capturing={capturing}
      onToggleVision={() => setVision((value) => !value)}
    />
  );
}
